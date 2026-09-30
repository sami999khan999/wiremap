import type { ShardKey } from "../primitive/index.js";

export interface ShardAssignment {
  readonly key: ShardKey;
  readonly node: number;
  readonly movedAt: Date | null;
  // Non-null while a move is in flight. The write freeze reads this: during a move the
  // tenant is readable on `node` and writable nowhere.
  readonly movingTo: number | null;
  // The way back. Set together when a move lands, cleared when the grace sweep drops
  // the source — so "is there still a copy to flip back to" is one nullable read.
  readonly movedFrom: number | null;
  readonly sourceDroppableAt: Date | null;
}

// The directory itself. No principal: this is a platform seam, like
// `MaintenanceGateway` — the move job and the shard map are its only readers.
export abstract class ShardAssignmentRepository {
  // Null rather than a throw: a tenant created before the directory existed has no
  // row, and node 0 is the honest answer for it.
  public abstract findByKey(key: ShardKey): Promise<ShardAssignment | null>;

  public abstract save(assignment: { key: ShardKey; node: number }): Promise<void>;

  // Keyset on the shard key, said so rather than an offset the adapter reinterprets:
  // `String(offset)` compared as text made page two every key after `"25"`.
  public abstract all(after: ShardKey | null, limit: number): Promise<readonly ShardAssignment[]>;

  // **Claims the move**, and answers false when one is already in flight or an earlier
  // move's source copy is on a node other than `toNode`. The `where` is the lock.
  public abstract beginMove(key: ShardKey, toNode: number): Promise<boolean>;

  // The flip. One statement: the node changes, `moving_to` clears and the way back is
  // stamped together, because a reader between two of those sees a tenant in no state.
  public abstract completeMove(key: ShardKey, droppableAt: Date): Promise<void>;

  // A move that failed. The node is unchanged — nothing was flipped — so this only
  // has to lift the freeze.
  public abstract abandonMove(key: ShardKey): Promise<void>;

  // What the grace sweep reclaims: moves whose source copy is past its window. Never a
  // tenant mid-move, whose way-back node may be the one it is being copied onto.
  public abstract droppableBefore(cutoff: Date, limit: number): Promise<readonly ShardAssignment[]>;

  // Called once the source rows are gone, so the row stops offering a way back that
  // no longer exists.
  public abstract forgetSource(key: ShardKey): Promise<void>;
}
