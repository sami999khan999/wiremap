import { type ShardAssignment, ShardAssignmentRepository, type ShardKey } from "../import.js";

// Rows in a Map, keyed the way the table is. Empty by default, which is the state that
// matters: a key with no row is node 0, and an unsharded deployment has no rows at all.
export class InMemoryShardAssignmentRepository extends ShardAssignmentRepository {
  private readonly rows = new Map<ShardKey, ShardAssignment>();

  public constructor(rows: readonly ShardAssignment[] = []) {
    super();
    for (const row of rows) this.rows.set(row.key, row);
  }

  public override findByKey(key: ShardKey): Promise<ShardAssignment | null> {
    return Promise.resolve(this.rows.get(key) ?? null);
  }

  public override save(assignment: { key: ShardKey; node: number }): Promise<void> {
    this.rows.set(assignment.key, {
      ...assignment,
      movedAt: null,
      movingTo: null,
      movedFrom: null,
      sourceDroppableAt: null,
    });
    return Promise.resolve();
  }

  // False when one is already in flight, like the single `update ... where` the real
  // one runs: a fake that always claimed would hide the double-start this guards.
  public override beginMove(key: ShardKey, toNode: number): Promise<boolean> {
    const row = this.rows.get(key);
    if (!row || row.movingTo !== null || row.node === toNode) return Promise.resolve(false);
    if (row.movedFrom !== null && row.movedFrom !== toNode) return Promise.resolve(false);

    this.rows.set(key, { ...row, movingTo: toNode });
    return Promise.resolve(true);
  }

  public override completeMove(key: ShardKey, droppableAt: Date): Promise<void> {
    const row = this.rows.get(key);
    if (!row || row.movingTo === null) return Promise.resolve();

    this.rows.set(key, {
      ...row,
      node: row.movingTo,
      movedFrom: row.node,
      movingTo: null,
      movedAt: new Date(),
      sourceDroppableAt: droppableAt,
    });
    return Promise.resolve();
  }

  public override abandonMove(key: ShardKey): Promise<void> {
    const row = this.rows.get(key);
    if (row) this.rows.set(key, { ...row, movingTo: null });
    return Promise.resolve();
  }

  public override droppableBefore(
    cutoff: Date,
    limit: number,
  ): Promise<readonly ShardAssignment[]> {
    const due = [...this.rows.values()]
      .filter((row) => row.sourceDroppableAt !== null && row.sourceDroppableAt < cutoff)
      .filter((row) => row.movedFrom !== null && row.movingTo === null)
      .toSorted((left, right) => left.key.localeCompare(right.key));

    return Promise.resolve(due.slice(0, limit));
  }

  public override forgetSource(key: ShardKey): Promise<void> {
    const row = this.rows.get(key);
    if (row) this.rows.set(key, { ...row, movedFrom: null, sourceDroppableAt: null });
    return Promise.resolve();
  }

  // Sorted and cut at the cursor, the way the real one is. A fake that sliced an offset
  // would let a caller that never advances the cursor pass here and loop in production.
  public override all(after: ShardKey | null, limit: number): Promise<readonly ShardAssignment[]> {
    const ordered = [...this.rows.values()].toSorted((left, right) =>
      left.key.localeCompare(right.key),
    );
    const rest = after ? ordered.filter((row) => row.key > after) : ordered;

    return Promise.resolve(rest.slice(0, limit));
  }
}
