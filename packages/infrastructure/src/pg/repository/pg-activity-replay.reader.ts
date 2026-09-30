import {
  type ActivityAction,
  type ActivityRecord,
  type ActivityReplayReader,
  ActivitySubject,
  and,
  asc,
  type DailyCount,
  eq,
  gte,
  inArray,
  lt,
  lte,
  not,
  type OrganizationId,
  type Placement,
  type ProjectionCheckpoint,
  type SQL,
  sql,
} from "../../import.js";
import { BaseRepository } from "../primitive/index.js";
import { activityLog } from "../schema/index.js";

// The read side of the audit trail. It exists for the projection pipeline: a derived
// store that cannot be rebuilt has quietly become a source of truth.
export class PgActivityReplayReader extends BaseRepository implements ActivityReplayReader {
  // Reads `activity_log`, which is on every node.
  protected override readonly placement: Placement = "local";

  // Keyset on `(occurred_at, id)` within one tenant: `>` drops a row sharing a microsecond,
  // `>=` replays one forever, and no tenant predicate appends every tenant's months.
  public async since(
    organizationId: OrganizationId,
    checkpoint: ProjectionCheckpoint,
    limit: number,
    excluding: readonly ActivityAction[] = [],
    // No default. A `new Date()` fallback reads as harmless and silently excludes every
    // row for a caller that has not been told the horizon exists.
    until: Date = new Date(8.64e15),
  ): Promise<readonly ActivityRecord[]> {
    // The row constructor, plus a redundant bound on the leading column (`CR.29`). The `OR`
    // form loses the index condition, so every page re-filtered from the month's start.
    const after =
      checkpoint.lastOccurredAt && checkpoint.lastId
        ? and(
            gte(activityLog.occurredAt, checkpoint.lastOccurredAt),
            sql`(${activityLog.occurredAt}, ${activityLog.id}) > (${checkpoint.lastOccurredAt}, ${checkpoint.lastId}::uuid)`,
          )
        : undefined;

    // A standby when the job allows one: the projection is the first read `24.3` moves.
    const reader = await this.reader();
    const rows = await reader
      .select({
        id: activityLog.id,
        organizationId: activityLog.organizationId,
        occurredAt: activityLog.occurredAt,
        actorId: activityLog.actorId,
        action: activityLog.action,
        payload: activityLog.payload,
      })
      .from(activityLog)
      .where(
        and(
          eq(activityLog.organizationId, organizationId),
          after,
          // The settle horizon. Without it a transaction that stamped an early
          // `occurred_at` and committed late lands below a checkpoint already past it.
          lte(activityLog.occurredAt, until),
          PgActivityReplayReader.without(excluding),
        ),
      )
      .orderBy(asc(activityLog.occurredAt), asc(activityLog.id))
      .limit(limit);

    return rows.map((row) => ({
      id: row.id,
      organizationId: row.organizationId as OrganizationId,
      occurredAt: row.occurredAt,
      actorId: row.actorId,
      action: row.action,
      // Lifted out of the bag because the derived store indexes on it, and JSON
      // extraction in a column-store ORDER BY is what makes a query slow.
      subjectId: ActivitySubject.of(row.payload),
      payload: row.payload,
    }));
  }

  // The Postgres half of the daily reconciliation. Neither store reaches into the other,
  // which is what keeps each adapter single-store.
  public async dailyCounts(
    organizationId: OrganizationId,
    from: Date,
    to: Date,
    excluding: readonly ActivityAction[] = [],
  ): Promise<readonly DailyCount[]> {
    const reader = await this.reader();
    const rows = await reader
      .select({
        day: sql<string>`to_char(date_trunc('day', ${activityLog.occurredAt}), 'YYYY-MM-DD')`.as(
          "day",
        ),
        rows: sql<number>`count(*)::int`.as("rows"),
      })
      .from(activityLog)
      .where(
        and(
          eq(activityLog.organizationId, organizationId),
          gte(activityLog.occurredAt, from),
          lt(activityLog.occurredAt, to),
          PgActivityReplayReader.without(excluding),
        ),
      )
      .groupBy(sql`1`)
      .orderBy(sql`1`);

    return rows;
  }

  // `undefined` for the empty case rather than `not inArray(…, [])`, which drizzle
  // renders as a predicate Postgres evaluates to false for every row.
  private static without(excluding: readonly ActivityAction[]): SQL | undefined {
    return excluding.length === 0 ? undefined : not(inArray(activityLog.action, [...excluding]));
  }
}
