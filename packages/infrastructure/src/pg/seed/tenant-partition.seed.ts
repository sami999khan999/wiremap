import {
  InternalError,
  type OrganizationId,
  PartitionedTable,
  type PartitionedTableEntry,
  type Placement,
  sql,
} from "../../import.js";
import { BaseRepository, type DrizzleClient } from "../primitive/index.js";

// Partition names to one `drop table`: the parent's lock is taken once per statement,
// so fifty is fifty times fewer, and the statement stays short enough to read in a log.
const DROP_BATCH = 50;

// How many months of runway a new tenant is given: the current one and the next two, the
// same count `MaintenanceConsumer` keeps ahead so the two cannot disagree.
const MONTHS = 3;

// Every tenant-owned table is partitioned by `organization_id`, so a row for a tenant
// with no partition is an insert error. This runs wherever an organization is created.
export class TenantPartitionSeed extends BaseRepository {
  // Partition DDL; `22.17` loops it per node.
  protected override readonly placement: Placement = "local";

  // Returns the partitions it created, empty on a tenant that already has them — the
  // idempotence every caller below depends on, since three of them can run twice.
  public async run(organizationId: OrganizationId): Promise<readonly string[]> {
    const now = new Date();
    // One read for all sixteen names rather than a probe each — `PF.4`.
    const absent = await this.absent(TenantPartitionSeed.expected(organizationId, now));
    const created: string[] = [];

    for (const entry of PartitionedTable.TENANT_PARTITIONED) {
      const tenant = TenantPartitionSeed.partitionName(entry.name, organizationId);

      if (absent.has(tenant)) {
        // Created standalone and then attached, never `create table … partition of`: that
        // form holds ACCESS EXCLUSIVE on the parent for the rest of the transaction.
        const level = entry.column ? ` partition by range ("${entry.column}")` : "";
        await this.db.execute(
          sql.raw(`create table ${tenant} (like ${entry.name} including all)${level}`),
        );
        await this.db.execute(
          sql.raw(
            `alter table ${entry.name} attach partition ${tenant} for values in ('${organizationId}')`,
          ),
        );
        created.push(tenant);
      }

      created.push(...(await this.months(entry, tenant, now, absent)));
    }

    return created;
  }

  // The tenants on this page that lack any partition `run` would create. A deploy calls
  // `run` for these alone, so a no-op deploy is one read per page rather than 16 per tenant.
  public async missing(
    organizationIds: readonly OrganizationId[],
  ): Promise<readonly OrganizationId[]> {
    const now = new Date();
    const owner = new Map<string, OrganizationId>();

    for (const id of organizationIds) {
      for (const name of TenantPartitionSeed.expected(id, now)) owner.set(name, id);
    }
    if (owner.size === 0) return [];

    const absent = await this.absent([...owner.keys()]);
    const short = new Set([...absent].map((name) => owner.get(name)));
    return organizationIds.filter((id) => short.has(id));
  }

  // The month level under one tenant partition, from the current month forward. Same
  // create-then-attach, for the same lock reason.
  private async months(
    entry: PartitionedTableEntry,
    tenant: string,
    now: Date,
    absent: ReadonlySet<string>,
  ): Promise<readonly string[]> {
    if (!entry.column) return [];

    const created: string[] = [];

    for (let offset = 0; offset < MONTHS; offset += 1) {
      const start = TenantPartitionSeed.monthStart(now, offset);
      const end = TenantPartitionSeed.monthStart(now, offset + 1);
      const name = `${tenant}_${TenantPartitionSeed.month(start)}`;
      if (!absent.has(name)) continue;

      await this.db.execute(sql.raw(`create table ${name} (like ${tenant} including all)`));
      await this.db.execute(
        sql.raw(
          `alter table ${tenant} attach partition ${name} ` +
            `for values from ('${TenantPartitionSeed.iso(start)}') to ('${TenantPartitionSeed.iso(end)}')`,
        ),
      );
      created.push(name);
    }

    return created;
  }

  // Which of `names` do not exist. `to_regclass` is null rather than an error, which
  // `CREATE TABLE IF NOT EXISTS` cannot say; one joined string, since drizzle binds arrays badly.
  private async absent(names: readonly string[]): Promise<ReadonlySet<string>> {
    const found = await this.db.execute<{ name: string }>(sql`
      select name from unnest(string_to_array(${names.join(",")}, ',')) as name
      where to_regclass('public.' || name) is null
    `);
    return new Set(found.rows.map((row) => row.name));
  }

  // Every partition a tenant should hold at `now`: the tenant level, and the runway months
  // under the three tables with a time column. The names `run` creates, in its order.
  private static expected(organizationId: OrganizationId, now: Date): readonly string[] {
    return PartitionedTable.TENANT_PARTITIONED.flatMap((entry) => {
      const tenant = TenantPartitionSeed.partitionName(entry.name, organizationId);
      if (!entry.column) return [tenant];

      const months = Array.from(
        { length: MONTHS },
        (_, offset) =>
          `${tenant}_${TenantPartitionSeed.month(TenantPartitionSeed.monthStart(now, offset))}`,
      );
      return [tenant, ...months];
    });
  }

  // Every named tenant's partitions of `tables`, months included. **No detach and no
  // transaction**: nothing references a tenant-partitioned table since `PF.1`, and each
  // ──
  // statement commits on its own, so a parent's ACCESS EXCLUSIVE lasts one drop — a
  // reader on one table delays that table alone. See docs/reference/partitions.md.
  public static async drop(
    client: DrizzleClient,
    organizationIds: readonly OrganizationId[],
    tables: readonly string[],
  ): Promise<readonly string[]> {
    const wanted = tables.flatMap((table) =>
      organizationIds.map((id) => ({ table, name: TenantPartitionSeed.partitionName(table, id) })),
    );
    if (wanted.length === 0) return [];

    // One probe for every name rather than one each. Inlined: each name was validated by
    // `partitionName`, and drizzle binds a JS array as a row constructor.
    const found = await client.execute<{ name: string }>(
      sql.raw(
        `select relname as name from pg_class where relkind in ('r', 'p') and relname in (${wanted
          .map((entry) => `'${entry.name}'`)
          .join(", ")})`,
      ),
    );
    const present = new Set(found.rows.map((row) => row.name));

    const dropped: string[] = [];
    for (const table of tables) {
      const names = wanted
        .filter((entry) => entry.table === table && present.has(entry.name))
        .map((entry) => entry.name);

      for (let at = 0; at < names.length; at += DROP_BATCH) {
        const batch = names.slice(at, at + DROP_BATCH);
        await client.execute(sql.raw(`drop table ${batch.join(", ")}`));
        dropped.push(...batch);
      }
    }

    return dropped;
  }

  // `<table>_<32hex>`, derived here alone and validated before it reaches `sql.raw`. The
  // longest is `notification_preferences_<32>` at 57 of Postgres's 63 characters.
  public static partitionName(table: string, organizationId: OrganizationId): string {
    const hex = organizationId.replaceAll("-", "").toLowerCase();
    if (!/^[0-9a-f]{32}$/.test(hex)) {
      throw new InternalError(new Error(`Not an organization id: ${organizationId}`));
    }
    return `${table}_${hex}`;
  }

  // UTC throughout: a boundary computed in the host's zone puts the first hours of a
  // month into the previous partition, or into none at all.
  private static monthStart(from: Date, offset: number): Date {
    return new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + offset, 1));
  }

  private static month(start: Date): string {
    return `${start.getUTCFullYear()}_${String(start.getUTCMonth() + 1).padStart(2, "0")}`;
  }

  private static iso(value: Date): string {
    return value.toISOString().slice(0, 10);
  }
}
