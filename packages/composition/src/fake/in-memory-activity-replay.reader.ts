import {
  type ActivityAction,
  type ActivityRecord,
  ActivityReplayReader,
  type DailyCount,
  type OrganizationId,
  type ProjectionCheckpoint,
} from "../import.js";

// Paginates the way Postgres does — keyset on `(occurredAt, id)`, not OFFSET. Ignoring
// the checkpoint would let a consumer that never advances its cursor pass every test.
export class InMemoryActivityReplayReader extends ActivityReplayReader {
  private readonly records: readonly ActivityRecord[];

  public constructor(records: readonly ActivityRecord[] = []) {
    super();
    this.records = [...records].sort((a, b) => InMemoryActivityReplayReader.byKeyset(a, b));
  }

  // Excluded **before** the slice, like the real one's `WHERE`: filtered after it, a
  // page of excluded rows comes back short and the caller reads that as caught up.
  public override since(
    organizationId: OrganizationId,
    checkpoint: ProjectionCheckpoint,
    limit: number,
    excluding: readonly ActivityAction[] = [],
    until: Date = new Date(8.64e15),
  ): Promise<readonly ActivityRecord[]> {
    const after = this.of(organizationId).filter((record) => {
      if (excluding.includes(record.action as ActivityAction)) return false;
      // The settle horizon, applied here like the real one's `WHERE`: a fake that
      // ignored it would let a consumer that forgot to pass one pass every test.
      if (record.occurredAt > until) return false;
      if (!checkpoint.lastOccurredAt || !checkpoint.lastId) return true;
      const delta = record.occurredAt.getTime() - checkpoint.lastOccurredAt.getTime();
      return delta > 0 || (delta === 0 && record.id > checkpoint.lastId);
    });

    return Promise.resolve(after.slice(0, limit));
  }

  public override dailyCounts(
    organizationId: OrganizationId,
    from: Date,
    to: Date,
    excluding: readonly ActivityAction[] = [],
  ): Promise<readonly DailyCount[]> {
    const counts = new Map<string, number>();

    for (const record of this.of(organizationId)) {
      if (record.occurredAt < from || record.occurredAt >= to) continue;
      if (excluding.includes(record.action as ActivityAction)) continue;
      const day = record.occurredAt.toISOString().slice(0, 10);
      counts.set(day, (counts.get(day) ?? 0) + 1);
    }

    return Promise.resolve(
      [...counts.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([day, rows]) => ({ day, rows })),
    );
  }

  // Every read here is per tenant, the way the real reader is: a fake that answered
  // across tenants would let a consumer that lost its tenant predicate pass.
  private of(organizationId: OrganizationId): readonly ActivityRecord[] {
    return this.records.filter((record) => record.organizationId === organizationId);
  }

  private static byKeyset(a: ActivityRecord, b: ActivityRecord): number {
    const delta = a.occurredAt.getTime() - b.occurredAt.getTime();
    return delta !== 0 ? delta : a.id.localeCompare(b.id);
  }
}
