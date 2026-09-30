import {
  type ActivityAction,
  type ActivityRecord,
  AnalyticsProjector,
  type DailyCount,
  type OrganizationId,
  type ProjectionCheckpoint,
} from "../import.js";

// Keyed on the activity id, like the real `ReplacingMergeTree`: one that appended would
// make a redelivered batch look like new work, and BullMQ redelivers.
export class InMemoryAnalyticsProjector extends AnalyticsProjector {
  private readonly rows = new Map<string, ActivityRecord>();
  private readonly applied: string[] = [];
  // What ClickHouse holds after the shipped `0000` migration, in the form it reads back
  // — so a fresh fake is a migrated store and the default converges without a rewrite.
  private ttl = "toDateTime(occurred_at) + toIntervalMonth(60)";

  public projected(): readonly ActivityRecord[] {
    return [...this.rows.values()];
  }

  // Read back out of the stored rows, so a test cannot pass by keeping a cursor the real
  // one does not have.
  public override checkpoint(organizationId: OrganizationId): Promise<ProjectionCheckpoint> {
    const last = [...this.of(organizationId)]
      .sort((a, b) => {
        const delta = a.occurredAt.getTime() - b.occurredAt.getTime();
        return delta !== 0 ? delta : a.id.localeCompare(b.id);
      })
      .at(-1);

    return Promise.resolve(
      last
        ? { lastOccurredAt: last.occurredAt, lastId: last.id }
        : { lastOccurredAt: null, lastId: null },
    );
  }

  public override project(records: readonly ActivityRecord[]): Promise<number> {
    for (const record of records) this.rows.set(record.id, record);
    return Promise.resolve(records.length);
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
      // Both sides subtract the same list, or every excluded row reads as drift on
      // the run after it was excluded.
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

  // Every read here is per tenant, the way both real stores are: a fake that answered
  // across tenants would let a consumer that lost its tenant predicate pass.
  private of(organizationId: OrganizationId): readonly ActivityRecord[] {
    return [...this.rows.values()].filter((row) => row.organizationId === organizationId);
  }

  // Rows, not a flag: the real one is a `DELETE`, so a fake that only recorded the
  // call would let a consumer that deleted the wrong tenant's rows pass.
  public override deleteTenant(organizationId: OrganizationId): Promise<void> {
    for (const [id, row] of this.rows) {
      if (row.organizationId === organizationId) this.rows.delete(id);
    }
    return Promise.resolve();
  }

  // A string, held. The real one reads it back off `system.tables`, so a fake that
  // returned a constant would let a caller that never applied anything pass.
  public override retention(): Promise<string> {
    return Promise.resolve(this.ttl);
  }

  public override applyRetention(expression: string): Promise<void> {
    this.ttl = expression;
    this.applied.push(expression);
    return Promise.resolve();
  }

  public retentionApplied(): readonly string[] {
    return this.applied;
  }

  public override healthy(): Promise<boolean> {
    return Promise.resolve(true);
  }

  public override close(): Promise<void> {
    return Promise.resolve();
  }
}
