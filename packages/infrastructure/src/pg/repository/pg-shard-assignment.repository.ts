import {
  and,
  asc,
  eq,
  gt,
  isNotNull,
  isNull,
  lt,
  ne,
  or,
  type Placement,
  type ShardAssignment,
  type ShardAssignmentRepository,
  type ShardKey,
  type ShardResolver,
  sql,
} from "../../import.js";
import { BaseRepository, type DatabaseCluster } from "../primitive/index.js";
import { shardAssignments } from "../schema/index.js";
import type { ShardScope, TransactionScope } from "../transaction/index.js";

export class PgShardAssignmentRepository
  extends BaseRepository
  implements ShardAssignmentRepository
{
  // The directory is read before any shard is known, which is what makes it catalog.
  protected override readonly placement: Placement = "catalog";

  // Named once: three reads answer the same shape, and a column added to one of them
  // and not the others is a move that looks finished from one angle.
  private static readonly COLUMNS = {
    key: shardAssignments.shardKey,
    node: shardAssignments.node,
    movedAt: shardAssignments.movedAt,
    movingTo: shardAssignments.movingTo,
    movedFrom: shardAssignments.movedFrom,
    sourceDroppableAt: shardAssignments.sourceDroppableAt,
  };

  public constructor(
    cluster: DatabaseCluster,
    scope: TransactionScope,
    shards: ShardScope,
    // The write invalidates the read-through cache. Without it a moved tenant keeps
    // reading the node it left for as long as the cache holds.
    private readonly resolver: ShardResolver,
  ) {
    super(cluster, scope, shards);
  }

  public async findByKey(key: ShardKey): Promise<ShardAssignment | null> {
    const rows = await this.db
      .select(PgShardAssignmentRepository.COLUMNS)
      .from(shardAssignments)
      .where(eq(shardAssignments.shardKey, key))
      .limit(1);

    const row = rows[0];
    return row ? { ...row, key: row.key as ShardKey } : null;
  }

  // `moved_at` is stamped only when the node actually changes: a re-save of the same
  // placement is not a move, and a timestamp that said otherwise would misread history.
  public async save(assignment: { key: ShardKey; node: number }): Promise<void> {
    const existing = await this.findByKey(assignment.key);
    const moved = existing !== null && existing.node !== assignment.node;

    await this.db
      .insert(shardAssignments)
      .values({ shardKey: assignment.key, node: assignment.node })
      .onConflictDoUpdate({
        target: shardAssignments.shardKey,
        set: { node: assignment.node, ...(moved ? { movedAt: new Date() } : {}) },
      });

    await this.resolver.invalidate(assignment.key);
  }

  // **One statement, and the `where` is the lock.** A read-then-write would let two
  // operators both see "no move in flight" and both start one.
  public async beginMove(key: ShardKey, toNode: number): Promise<boolean> {
    const claimed = await this.db
      .update(shardAssignments)
      .set({ movingTo: toNode })
      .where(
        and(
          eq(shardAssignments.shardKey, key),
          isNull(shardAssignments.movingTo),
          ne(shardAssignments.node, toNode),
          // A source copy elsewhere would be orphaned by the flip, which overwrites the
          // only column naming it. The same node is the way back, and `prepare` empties it.
          or(isNull(shardAssignments.movedFrom), eq(shardAssignments.movedFrom, toNode)),
        ),
      )
      .returning({ key: shardAssignments.shardKey });

    // The freeze has to be visible now, not in five minutes: the cached placement is
    // what every write reads, and the copy starts the moment this returns.
    if (claimed.length > 0) await this.resolver.invalidate(key);
    return claimed.length > 0;
  }

  // The flip, and it is one statement for a reason: a reader between the node change
  // and the `moving_to` clear would see a tenant frozen on a node it has already left.
  public async completeMove(key: ShardKey, droppableAt: Date): Promise<void> {
    await this.db.execute(sql`
      update shard_assignments
      set moved_from = node,
          node = moving_to,
          moving_to = null,
          moved_at = now(),
          source_droppable_at = ${droppableAt}
      where shard_key = ${key} and moving_to is not null
    `);

    await this.resolver.invalidate(key);
  }

  // Nothing was flipped, so this only lifts the freeze. The copied rows on the target
  // are left for the next attempt, which is idempotent over them.
  public async abandonMove(key: ShardKey): Promise<void> {
    await this.db
      .update(shardAssignments)
      .set({ movingTo: null })
      .where(eq(shardAssignments.shardKey, key));

    await this.resolver.invalidate(key);
  }

  public async droppableBefore(cutoff: Date, limit: number): Promise<readonly ShardAssignment[]> {
    const rows = await this.db
      .select(PgShardAssignmentRepository.COLUMNS)
      .from(shardAssignments)
      .where(
        and(
          isNotNull(shardAssignments.sourceDroppableAt),
          isNotNull(shardAssignments.movedFrom),
          lt(shardAssignments.sourceDroppableAt, cutoff),
          // A move back is copying onto the node this would drop.
          isNull(shardAssignments.movingTo),
        ),
      )
      .orderBy(asc(shardAssignments.shardKey))
      .limit(limit);

    return rows.map((row) => ({ ...row, key: row.key as ShardKey }));
  }

  // Both cleared together: `moved_from` without `source_droppable_at` would offer a way
  // back to rows that are gone.
  public async forgetSource(key: ShardKey): Promise<void> {
    await this.db
      .update(shardAssignments)
      .set({ movedFrom: null, sourceDroppableAt: null })
      .where(eq(shardAssignments.shardKey, key));
  }

  // Keyset on `shard_key`, not offset: the move job walks every tenant, and a
  // deployment that needs sharding is one where `OFFSET 40000` is the problem.
  public async all(after: ShardKey | null, limit: number): Promise<readonly ShardAssignment[]> {
    const rows = await this.db
      .select(PgShardAssignmentRepository.COLUMNS)
      .from(shardAssignments)
      .where(after ? gt(shardAssignments.shardKey, after) : undefined)
      .orderBy(asc(shardAssignments.shardKey))
      .limit(limit);

    return rows.map((row) => ({ ...row, key: row.key as ShardKey }));
  }
}
