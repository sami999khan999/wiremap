import {
  type DanglingConversations,
  InternalError,
  inArray,
  lt,
  type MaintenanceGateway,
  type OrganizationId,
  type PartitionEstimate,
  PartitionedTable,
  type PartitionedTableName,
  type Placement,
  type SweepOutcome,
  sql,
  type TenantRunway,
  type UnitOfWork,
  Uuid,
} from "../../import.js";
import { BaseRepository, type DatabaseCluster } from "../primitive/index.js";
import {
  invitations,
  organizations,
  sessions,
  spareTenants,
  verifications,
} from "../schema/index.js";
import { TenantPartitionSeed } from "../seed/index.js";
import type { ShardScope, TransactionScope } from "../transaction/index.js";

// One child of the parent, with what the retention preview wants to know about it.
interface ChildRow extends Record<string, unknown> {
  readonly name: string;
  readonly estimated_rows: string;
  readonly bytes: string;
}

export class PgMaintenanceGateway extends BaseRepository implements MaintenanceGateway {
  // Partition DDL on local and routed tables alike; `22.17` loops it per node.
  protected override readonly placement: Placement = "local";

  // A fixed namespace for `pg_advisory_xact_lock`'s two-argument form, so this lock
  // cannot collide with one taken for another reason.
  private static readonly LOCK_NAMESPACE = 0x6c62_0002 | 0;

  private readonly tenantPartitions = new TenantPartitionSeed(
    this.cluster,
    this.scope,
    this.shards,
  );

  public constructor(
    cluster: DatabaseCluster,
    scope: TransactionScope,
    shards: ShardScope,
    private readonly unitOfWork: UnitOfWork,
  ) {
    super(cluster, scope, shards);
  }

  // **`catalogDb`, not `db`.** All three tables are catalog ones, and this gateway is
  // `local` — so `db` would sweep whichever node a surrounding loop had placed it on.
  public async sweepExpired(now: Date): Promise<SweepOutcome> {
    // Two statements rather than one CTE: they hit different indexes, and a failure
    // sweeping one should not hold the other's rows.
    const expiredSessions = await this.catalogDb
      .delete(sessions)
      .where(lt(sessions.expiresAt, now));

    const expiredVerifications = await this.catalogDb
      .delete(verifications)
      .where(lt(verifications.expiresAt, now));

    // Swept for a reason the other two do not have: `invitations_email_uq` means a lapsed
    // row keeps that address un-invitable until it is gone.
    const expiredInvitations = await this.catalogDb
      .delete(invitations)
      .where(lt(invitations.expiresAt, now));

    // The command tag, never `.returning()`: the caller wants a count, and returning ids
    // ships every expired row back over the wire to be counted and thrown away.
    return {
      sessions: expiredSessions.rowCount ?? 0,
      verifications: expiredVerifications.rowCount ?? 0,
      invitations: expiredInvitations.rowCount ?? 0,
    };
  }

  // Delegated rather than reimplemented: the signup path calls the seed directly inside
  // its own transaction, and a second copy here is the one that drifts.
  public ensureTenantPartitions(organizationId: OrganizationId): Promise<readonly string[]> {
    return this.tenantPartitions.run(organizationId);
  }

  // One spare per transaction, its row and its partitions together, so a crash leaves
  // neither half. Node 0 alone: the founder places every tenant there, and it is the catalog.
  public async topUpSpareTenants(target: number): Promise<number> {
    const [row] = await this.catalogDb
      .select({ spares: sql<number>`count(*)::int` })
      .from(spareTenants);
    const short = target - (row?.spares ?? 0);

    for (let made = 0; made < short; made += 1) {
      await this.unitOfWork.run(async () => {
        const id = Uuid.v7() as OrganizationId;
        await this.db.insert(spareTenants).values({ id });
        await this.tenantPartitions.run(id);
      });
    }

    return Math.max(0, short);
  }

  // Outside any transaction on purpose, and idempotent: the purge runs it before its own
  // transaction, and a retry after a partial drop finds only what is left.
  public dropTenantPartitions(organizationId: OrganizationId): Promise<readonly string[]> {
    return TenantPartitionSeed.drop(
      this.db,
      [organizationId],
      [...PartitionedTable.TENANT_PARTITIONED].reverse().map((entry) => entry.name),
    );
  }

  // **Two reads, never a join.** The candidates are on this node and `organizations` is
  // on the catalog, which after the split is a different database entirely.
  public async orphanedTenants(): Promise<readonly OrganizationId[]> {
    const candidates = await this.tenantsWithRowsHere();
    if (candidates.length === 0) return [];

    // The second read, and the only one that may cross: this gateway is `local`, and
    // `catalogDb` is the sanctioned crossing from `local`.
    const live = await this.catalogDb
      .select({ id: organizations.id })
      .from(organizations)
      .where(inArray(organizations.id, candidates as OrganizationId[]));
    // A spare has partitions and no organization on purpose — `PF.3`. It is not a leak.
    const spares = await this.catalogDb
      .select({ id: spareTenants.id })
      .from(spareTenants)
      .where(inArray(spareTenants.id, candidates as OrganizationId[]));

    const present = new Set<string>([...live, ...spares].map((row) => row.id));
    return candidates.filter((id) => !present.has(id)) as OrganizationId[];
  }

  // **One tenant per statement** (`CR.21`). One statement over every tenant locked every
  // `messages` leaf on the node at once and ran out of lock slots near 1 860 tenants.
  // ──
  // Each statement prunes to one tenant's partitions and commits on its own, so the locks
  // it holds are that tenant's. The tenant list is the partition names, which cost nothing.
  public async danglingConversations(): Promise<DanglingConversations> {
    let members = 0;
    let messages = 0;

    for (const organizationId of await this.tenantsWithRowsHere()) {
      const found = await this.db.execute<{ members: string; messages: string }>(sql`
        select
          (select count(*) from (
            select distinct conversation_id from conversation_members
            where organization_id = ${organizationId}
          ) m where not exists (
            select 1 from conversations c
            where c.organization_id = ${organizationId} and c.id = m.conversation_id
          ))::text as members,
          (select count(*) from (
            select distinct conversation_id from messages
            where organization_id = ${organizationId}
          ) m where not exists (
            select 1 from conversations c
            where c.organization_id = ${organizationId} and c.id = m.conversation_id
          ))::text as messages
      `);

      const row = found.rows[0];
      members += Number(row?.members ?? 0);
      messages += Number(row?.messages ?? 0);
    }

    return { members, messages };
  }

  // Partition names, not a scan: a tenant table is LIST-partitioned by tenant, so the
  // catalog of children already answers "who has rows here" for the cost of a lookup.
  private async tenantsWithRowsHere(): Promise<readonly string[]> {
    // Inlined, not bound: drizzle sends a JS array as a row constructor and `= any($1)`
    // then fails with "requires array on right side". Every name is from the allowlist.
    const parents = PartitionedTable.TENANT_PARTITIONED.map((entry) => `'${entry.name}'`).join(
      ", ",
    );

    const found = await this.db.execute<{ hex: string | null }>(
      sql.raw(`
        select distinct substring(c.relname from '_([0-9a-f]{32})$') as hex
        from pg_inherits i
        join pg_class c on c.oid = i.inhrelid
        join pg_class p on p.oid = i.inhparent
        where p.relname in (${parents})
          and c.relname ~ '_[0-9a-f]{32}$'
      `),
    );

    const fromPartitions = found.rows
      .map((row) => row.hex)
      .filter((hex): hex is string => hex !== null)
      .map((hex) => PgMaintenanceGateway.uuidOf(hex));

    // `outbox_event` has no tenant level, so no partition names it. Indexed, so the
    // distinct is an index scan rather than a walk of every month.
    const events = await this.db.execute<{ id: string }>(
      sql`select distinct organization_id::text as id from outbox_event`,
    );

    return [...new Set([...fromPartitions, ...events.rows.map((row) => row.id)])];
  }

  // The partition suffix is the tenant id with its dashes stripped, which is what
  // `TenantPartitionSeed.partitionName` writes. This is that, backwards.
  private static uuidOf(hex: string): string {
    return [
      hex.slice(0, 8),
      hex.slice(8, 12),
      hex.slice(12, 16),
      hex.slice(16, 20),
      hex.slice(20),
    ].join("-");
  }

  public async ensureMonthlyPartitions(
    table: PartitionedTableName,
    organizationId: OrganizationId | null,
    from: Date,
    months: number,
  ): Promise<readonly string[]> {
    const parent = this.monthParent(table, organizationId);
    const created: string[] = [];

    // One transaction holding one advisory lock per table, because probe-and-create is
    // two statements: two replicas booting together both probe absent and one gets 42P07.
    await this.unitOfWork.run(async () => {
      const lock = PgMaintenanceGateway.lockFor(table);
      await this.db.execute(sql`select pg_advisory_xact_lock(${lock.namespace}, ${lock.key})`);

      // From the month `from` falls in, inclusive — so `months` is a count of partitions
      // and the runway it buys is one less than that.
      for (let offset = 0; offset < months; offset += 1) {
        const start = PgMaintenanceGateway.monthStart(from, offset);
        const end = PgMaintenanceGateway.monthStart(from, offset + 1);
        const name = `${parent}_${PgMaintenanceGateway.monthSuffix(start)}`;

        // `to_regclass` returns null rather than throwing, which `CREATE TABLE IF NOT
        // EXISTS … PARTITION OF` cannot tell us: it reports nothing about what it did.
        const probe = await this.db.execute<{ present: string | null }>(
          sql`select to_regclass(${`public.${name}`})::text as present`,
        );
        if (probe.rows[0]?.present) continue;

        // Created standalone and then attached, for the lock reason `TenantPartitionSeed`
        // gives. Inlined because Postgres accepts no bind parameters in DDL.
        await this.db.execute(sql.raw(`create table ${name} (like ${parent} including all)`));
        await this.db.execute(
          sql.raw(
            `alter table ${parent} attach partition ${name} ` +
              `for values from ('${PgMaintenanceGateway.iso(start)}') to ('${PgMaintenanceGateway.iso(end)}')`,
          ),
        );

        created.push(name);
      }
    });

    return created;
  }

  // The lock first and the read inside it, so two replicas cannot both read a month as
  // absent. One transaction for the page: `ATTACH` blocks no read or write a request makes.
  public async ensureMonthlyPartitionsFor(
    table: PartitionedTableName,
    organizationIds: readonly OrganizationId[],
    from: Date,
    months: number,
  ): Promise<readonly TenantRunway[]> {
    if (organizationIds.length === 0) return [];

    const boundary = PgMaintenanceGateway.monthStart(from, 1);
    const runways: TenantRunway[] = [];

    await this.unitOfWork.run(async () => {
      const lock = PgMaintenanceGateway.lockFor(table);
      await this.db.execute(sql`select pg_advisory_xact_lock(${lock.namespace}, ${lock.key})`);

      const parents = organizationIds.map((id) => this.monthParent(table, id));
      const children = await this.childrenByParent(parents);

      for (const [index, organizationId] of organizationIds.entries()) {
        const parent = parents[index] ?? "";
        const existing = new Set(children.get(parent) ?? []);
        const monthsAhead = [...existing].filter((name) => {
          const start = PgMaintenanceGateway.partitionMonth(parent, name);
          return start !== null && start.getTime() >= boundary.getTime();
        }).length;

        const created: string[] = [];
        for (let offset = 0; offset < months; offset += 1) {
          const start = PgMaintenanceGateway.monthStart(from, offset);
          const end = PgMaintenanceGateway.monthStart(from, offset + 1);
          const name = `${parent}_${PgMaintenanceGateway.monthSuffix(start)}`;
          if (existing.has(name)) continue;

          await this.db.execute(sql.raw(`create table ${name} (like ${parent} including all)`));
          await this.db.execute(
            sql.raw(
              `alter table ${parent} attach partition ${name} ` +
                `for values from ('${PgMaintenanceGateway.iso(start)}') to ('${PgMaintenanceGateway.iso(end)}')`,
            ),
          );
          created.push(name);
        }

        runways.push({ organizationId, monthsAhead, created });
      }
    });

    return runways;
  }

  // Strictly after the month `from` falls in, so the current month is never counted as
  // runway — it is the one being written to.
  public async monthlyPartitionsAfter(
    table: PartitionedTableName,
    organizationId: OrganizationId | null,
    from: Date,
  ): Promise<number> {
    const parent = this.monthParent(table, organizationId);
    const boundary = PgMaintenanceGateway.monthStart(from, 1);
    const children = await this.childrenOf(parent);

    return children.filter((child) => {
      const start = PgMaintenanceGateway.partitionMonth(parent, child.name);
      return start !== null && start.getTime() >= boundary.getTime();
    }).length;
  }

  public async dropMonthlyPartitionsBefore(
    table: PartitionedTableName,
    organizationId: OrganizationId | null,
    cutoff: Date,
  ): Promise<readonly string[]> {
    const boundary = PgMaintenanceGateway.monthStart(cutoff, 0);
    const dropped: string[] = [];

    // Null on a tenant-partitioned table is every tenant, the same reading
    // `partitionsBefore` has — otherwise a caller previews across tenants and drops one.
    for (const [parent, children] of await this.monthChildren(table, organizationId)) {
      for (const child of children) {
        const start = PgMaintenanceGateway.partitionMonth(parent, child.name);
        // A name the pattern does not match is left alone rather than dropped: this
        // loop holds a `drop table`, and "I could not parse it" is not a reason to run.
        if (!start || start.getTime() >= boundary.getTime()) continue;

        // Re-derived from the parsed month, never interpolated from the catalog string.
        await this.db.execute(
          sql.raw(`drop table if exists ${parent}_${PgMaintenanceGateway.monthSuffix(start)}`),
        );
        dropped.push(child.name);
      }
    }

    return dropped;
  }

  // One `attach`, and the bounds are derived from a `Date` rather than passed: a caller
  // that could name its own range could attach a month over another month's rows.
  public async attachMonthlyPartition(
    table: PartitionedTableName,
    organizationId: OrganizationId | null,
    period: Date,
    scratchTable: string,
  ): Promise<void> {
    const parent = this.monthParent(table, organizationId);
    const from = PgMaintenanceGateway.iso(PgMaintenanceGateway.monthStart(period, 0));
    const to = PgMaintenanceGateway.iso(PgMaintenanceGateway.monthStart(period, 1));

    // Validated before it reaches `sql.raw`: the name comes from the archive gateway
    // and is derived, but this is the boundary and derivation is not a guarantee.
    if (!/^[a-z0-9_]+$/.test(scratchTable)) {
      throw new InternalError(new Error(`Not a table name: ${scratchTable}`));
    }

    await this.db.execute(
      sql.raw(
        `alter table ${parent} attach partition ${scratchTable} ` +
          `for values from ('${from}') to ('${to}')`,
      ),
    );
  }

  // Across every tenant when `organizationId` is null, and the same parse the drop uses
  // off the same read — so the two cannot disagree about what a child is.
  public async partitionsBefore(
    table: PartitionedTableName,
    cutoff: Date,
    organizationId?: OrganizationId | null,
  ): Promise<readonly PartitionEstimate[]> {
    const boundary = PgMaintenanceGateway.monthStart(cutoff, 0);
    const estimates: PartitionEstimate[] = [];

    for (const [parent, children] of await this.monthChildren(table, organizationId ?? null)) {
      for (const child of children) {
        const period = PgMaintenanceGateway.partitionMonth(parent, child.name);
        if (!period || period.getTime() >= boundary.getTime()) continue;

        estimates.push({
          name: child.name,
          period,
          // `reltuples` is the planner's estimate, refreshed by autovacuum or ANALYZE,
          // and -1 on a child never analysed — hence the floor, and hence "about".
          estimatedRows: Math.max(0, Number(child.estimated_rows)),
          bytes: Number(child.bytes),
        });
      }
    }

    return estimates;
  }

  // The parent a month hangs off: the tenant partition, or the table for `outbox_event`.
  // An argument disagreeing with the allowlist is an error here, not a wrong `drop table`.
  private monthParent(table: PartitionedTableName, organizationId: OrganizationId | null): string {
    const entry = PartitionedTable.byName(table);
    if (!entry.column) throw new InternalError(new Error(`${table} has no month level`));

    if (!entry.tenantKey) {
      if (organizationId) throw new InternalError(new Error(`${table} has no tenant level`));
      return table;
    }

    if (!organizationId) throw new InternalError(new Error(`${table} is partitioned by tenant`));
    return TenantPartitionSeed.partitionName(table, organizationId);
  }

  // From the catalog rather than from a date range: a gap in the sequence, or a month
  // created by hand, is still a partition and still has to be found.
  private async childrenOf(parent: string): Promise<readonly ChildRow[]> {
    const rows = await this.db.execute<ChildRow>(sql`
      select child.relname as name,
             greatest(child.reltuples, 0)::bigint::text as estimated_rows,
             pg_total_relation_size(child.oid)::bigint::text as bytes
      from pg_inherits
      join pg_class parent on parent.oid = pg_inherits.inhparent
      join pg_class child on child.oid = pg_inherits.inhrelid
      where parent.relname = ${parent}
      order by child.relname
    `);

    return rows.rows;
  }

  // Every month child under the parents `organizationId` names, by parent. Null on a
  // tenant table is every tenant, and **one read** for all of them rather than one each.
  private async monthChildren(
    table: PartitionedTableName,
    organizationId: OrganizationId | null,
  ): Promise<ReadonlyMap<string, readonly ChildRow[]>> {
    if (!(PartitionedTable.byName(table).tenantKey && !organizationId)) {
      const parent = this.monthParent(table, organizationId);
      return new Map([[parent, await this.childrenOf(parent)]]);
    }

    // From the catalog rather than from `organizations`: a partition with no tenant row
    // is exactly the leak the preview exists to show.
    const rows = await this.db.execute<ChildRow & { parent: string }>(sql`
      select parent.relname as parent,
             child.relname as name,
             greatest(child.reltuples, 0)::bigint::text as estimated_rows,
             pg_total_relation_size(child.oid)::bigint::text as bytes
      from pg_inherits
      join pg_class parent on parent.oid = pg_inherits.inhparent
      join pg_class child on child.oid = pg_inherits.inhrelid
      where parent.relname ~ ${`^${table}_[0-9a-f]{32}$`}
      order by parent.relname, child.relname
    `);

    const grouped = new Map<string, ChildRow[]>();
    for (const row of rows.rows) {
      const list = grouped.get(row.parent) ?? [];
      list.push(row);
      grouped.set(row.parent, list);
    }
    return grouped;
  }

  // Child names under each of `parents`, in one read. Inlined: every name came from
  // `partitionName`, which validates it, and drizzle binds a JS array as a row.
  private async childrenByParent(
    parents: readonly string[],
  ): Promise<ReadonlyMap<string, readonly string[]>> {
    const rows = await this.db.execute<{ parent: string; name: string }>(
      sql.raw(`
        select parent.relname as parent, child.relname as name
        from pg_inherits
        join pg_class parent on parent.oid = pg_inherits.inhparent
        join pg_class child on child.oid = pg_inherits.inhrelid
        where parent.relname in (${parents.map((parent) => `'${parent}'`).join(", ")})
      `),
    );

    const grouped = new Map<string, string[]>();
    for (const row of rows.rows) {
      const list = grouped.get(row.parent) ?? [];
      list.push(row.name);
      grouped.set(row.parent, list);
    }
    return grouped;
  }

  // Public because an advisory lock *is* a cross-process protocol: another process has
  // to be able to name the same lock, and a spec proving the guard is one of them.
  public static lockFor(table: PartitionedTableName): { namespace: number; key: number } {
    // The table name folded to an int. A collision would only make two tables ensure
    // their partitions one after the other.
    let hash = 0;
    for (const char of table) hash = (Math.imul(hash, 31) + char.charCodeAt(0)) | 0;
    return { namespace: PgMaintenanceGateway.LOCK_NAMESPACE, key: hash };
  }

  // UTC throughout: a boundary computed in the host's zone puts the first hours of a
  // month into the previous partition, or into none at all.
  private static monthStart(from: Date, offset: number): Date {
    return new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + offset, 1));
  }

  private static monthSuffix(start: Date): string {
    return `${start.getUTCFullYear()}_${String(start.getUTCMonth() + 1).padStart(2, "0")}`;
  }

  // Null for anything that is not `<parent>_<yyyy>_<mm>`, which is what makes the drop
  // loop above safe to run over whatever the catalog happens to return.
  private static partitionMonth(parent: string, name: string): Date | null {
    const escaped = parent.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = new RegExp(`^${escaped}_(\\d{4})_(\\d{2})$`).exec(name);
    if (!match?.[1] || !match[2]) return null;

    const month = Number(match[2]);
    if (month < 1 || month > 12) return null;

    return new Date(Date.UTC(Number(match[1]), month - 1, 1));
  }

  private static iso(value: Date): string {
    return value.toISOString().slice(0, 10);
  }
}
