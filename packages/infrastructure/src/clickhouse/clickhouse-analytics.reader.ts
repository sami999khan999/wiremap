import type { ActivityCount, AnalyticsReader, OrganizationId } from "../import.js";
import type { ClickHouseConnection } from "./clickhouse.connection.js";

// The read side of `activity_events` — `23.14`. A second class over the same connection,
// not a method on the projector, so a dashboard never holds the object that writes.
export class ClickHouseAnalyticsReader implements AnalyticsReader {
  private static readonly TABLE = "activity_events";

  public constructor(private readonly connection: ClickHouseConnection) {}

  // `FINAL`, as `dailyCounts` reads it: the table is a `ReplacingMergeTree` and the
  // projection is at-least-once, so an unmerged redelivery would count twice without it.
  public async activityByDay(
    organizationId: OrganizationId,
    from: string,
    to: string,
  ): Promise<readonly ActivityCount[]> {
    return this.connection.query<ActivityCount>(
      `
      SELECT
        formatDateTime(toDate(occurred_at), '%Y-%m-%d') AS day,
        action,
        toUInt32(count())                               AS count
      FROM ${this.connection.qualified(ClickHouseAnalyticsReader.TABLE)} FINAL
      WHERE organization_id = {organizationId:UUID}
        AND occurred_at >= {from:DateTime64(3)} AND occurred_at < {to:DateTime64(3)}
      GROUP BY day, action
      ORDER BY day, action
    `,
      {
        organizationId,
        from: new Date(`${from}T00:00:00.000Z`),
        to: new Date(`${to}T00:00:00.000Z`),
      },
    );
  }
}
