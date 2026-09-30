import {
  asc,
  desc,
  eq,
  type OrganizationId,
  type PaginationQuery,
  type Placement,
  sql,
  type TenantStorageMonth,
  type TenantStoragePage,
  type TenantStorageReader,
  type TenantStorageRow,
} from "../../import.js";
import { BaseRepository } from "../primitive/index.js";
import { organizations, partitionArchive } from "../schema/index.js";

// `sum()` over `bigint` comes back as numeric, which node-postgres hands over as a
// string. Cast in SQL and convert here rather than letting a byte total be `"42"`.
const numberOf = (value: unknown): number => Number(value ?? 0);

export class PgTenantStorageReader extends BaseRepository implements TenantStorageReader {
  // `partition_archive` joined to `organizations`, both catalog.
  protected override readonly placement: Placement = "catalog";

  public async byTenant(
    page: PaginationQuery,
    organizationId: OrganizationId | null,
  ): Promise<TenantStoragePage> {
    const filter = organizationId ? eq(partitionArchive.organizationId, organizationId) : undefined;

    const rows = await this.db
      .select({
        organizationId: partitionArchive.organizationId,
        organizationName: organizations.name,
        tableName: partitionArchive.tableName,
        bytes: sql<string>`sum(${partitionArchive.bytes})`,
        rows: sql<string>`sum(${partitionArchive.rowCount})`,
        months: sql<number>`count(distinct ${partitionArchive.period})::int`,
      })
      .from(partitionArchive)
      // Left, because a deleted tenant's objects outlive its row by thirty days and
      // an inner join would hide exactly the rows an operator came here to find.
      .leftJoin(organizations, eq(organizations.id, partitionArchive.organizationId))
      .where(filter)
      .groupBy(partitionArchive.organizationId, organizations.name, partitionArchive.tableName)
      // The tie-break is not cosmetic under `limit`/`offset`: two tenants with equal
      // totals have no defined order, so one can appear on two pages or on neither.
      .orderBy(
        desc(sql`sum(${partitionArchive.bytes})`),
        asc(partitionArchive.organizationId),
        asc(partitionArchive.tableName),
      )
      .limit(page.limit)
      .offset(page.offset);

    return {
      items: rows.map((row) => PgTenantStorageReader.rowOf(row)),
      total: await this.countGroups(filter),
    };
  }

  public async monthsFor(organizationId: OrganizationId): Promise<readonly TenantStorageMonth[]> {
    const rows = await this.db
      .select({
        tableName: partitionArchive.tableName,
        period: partitionArchive.period,
        bytes: partitionArchive.bytes,
        rows: partitionArchive.rowCount,
        actionCounts: partitionArchive.actionCounts,
        projectedAt: partitionArchive.projectedAt,
      })
      .from(partitionArchive)
      .where(eq(partitionArchive.organizationId, organizationId))
      .orderBy(desc(partitionArchive.period), partitionArchive.tableName);

    return rows;
  }

  // One row per group, counted separately: `count(*)` beside a `group by` counts
  // within each group, not the groups.
  private async countGroups(filter: ReturnType<typeof eq> | undefined): Promise<number> {
    const grouped = this.db
      .select({ one: sql<number>`1` })
      .from(partitionArchive)
      .where(filter)
      .groupBy(partitionArchive.organizationId, partitionArchive.tableName)
      .as("grouped");

    const rows = await this.db.select({ total: sql<number>`count(*)::int` }).from(grouped);

    return rows[0]?.total ?? 0;
  }

  private static rowOf(row: {
    organizationId: OrganizationId;
    organizationName: string | null;
    tableName: string;
    bytes: string;
    rows: string;
    months: number;
  }): TenantStorageRow {
    return {
      organizationId: row.organizationId,
      organizationName: row.organizationName,
      tableName: row.tableName,
      bytes: numberOf(row.bytes),
      rows: numberOf(row.rows),
      months: row.months,
    };
  }
}
