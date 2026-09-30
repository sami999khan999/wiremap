import type { ShardKey } from "../primitive/index.js";

// Key to physical node. A directory read, cached: it is on the path of every routed
// query, and the answer changes only when a tenant is moved.
export interface ShardPlacement {
  readonly node: number;
  // True while a move is in flight. The tenant is readable on `node` and writable
  // nowhere — see `PgUnitOfWork.run` and decision `24.2`.
  readonly frozen: boolean;
}

export abstract class ShardResolver {
  // Resolved once per request beside the node, because `PgUnitOfWork.run` is on the
  // write path and cannot afford a round trip to ask whether a move is running.
  public abstract placementOf(key: ShardKey): Promise<ShardPlacement>;

  // A physical node, not a virtual shard — decision D28 removed the level between.
  // A key with no row is node 0, which is what an unsharded deployment is.
  public abstract resolve(key: ShardKey): Promise<number>;

  // Called by the move job, and by nothing else. Without it a moved tenant keeps
  // reading the node it left for as long as the cache holds.
  public abstract invalidate(key: ShardKey): Promise<void>;
}
