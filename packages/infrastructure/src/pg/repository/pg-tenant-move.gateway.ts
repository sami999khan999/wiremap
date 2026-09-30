import {
  InternalError,
  type OrganizationId,
  PartitionedTable,
  Shard,
  type ShardResolver,
  sql,
  TablePlacement,
  type TableRowCount,
  TenantMoveGateway,
} from "../../import.js";
import type { DatabaseCluster, DrizzleClient } from "../primitive/index.js";
import { TenantPartitionSeed } from "../seed/index.js";
import type { ShardScope, TransactionScope } from "../transaction/index.js";

// Annotated at the call site as well, because `cursor` is assigned out of the page and
// the inference would otherwise be circular.
interface PageRow extends Record<string, unknown> {
  readonly id: string;
  readonly row: Record<string, unknown>;
}

interface PageResult {
  readonly rows: readonly PageRow[];
}

export interface PgTenantMoveGatewayConfig {
  // How long a request or job may run on a placement it resolved before the freeze.
  // Zero in a spec, which owns every writer it starts.
  readonly settleMs: number;
}

// Rows per statement. Large enough that a small tenant is one round trip each way,
// small enough that one page is a parameter Postgres will accept.
const PAGE = 500;

// How long the quiesce waits on a writer that is still open. A move that cannot get
// the lock fails and lifts the freeze, which is cheaper than an unbounded wait.
const QUIESCE_TIMEOUT_MS = 60_000;

// The tenant's own rows, in the order a copy has to write them: a table is listed after
// the tables it references, so the sibling keys on the target are satisfied as it goes.
const TABLES: readonly string[] = [
  ...PartitionedTable.TENANT_PARTITIONED.map((entry) => entry.name),
  // Not tenant-partitioned, so no partition names it and the drop below is a delete.
  // Copied anyway: its months are the tenant's, and retention is what ends them.
  "outbox_event",
];

// Node 0 is the catalog, and a catalog transaction writes a tenant's audit rows and
// events there wherever the tenant lives. Those rows exist on no other node.
const CATALOG_NODE = 0;

// A partition name read back out of `pg_class` before it is inlined into DDL.
const IDENTIFIER = /^[a-z0-9_]+$/;
const RANGE_BOUND = /^FOR VALUES FROM \('[0-9:+. -]+'\) TO \('[0-9:+. -]+'\)$/;

// **The one seam that addresses two nodes at once.** Not a `BaseRepository`: that reads
// tables of one placement on one node, which is exactly what a move is not.
export class PgTenantMoveGateway extends TenantMoveGateway {
  public constructor(
    private readonly cluster: DatabaseCluster,
    private readonly scope: TransactionScope,
    private readonly shards: ShardScope,
    private readonly resolver: ShardResolver,
    private readonly config: PgTenantMoveGatewayConfig = { settleMs: 0 },
  ) {
    super();
  }

  // Time first, then a lock. The wait covers a writer that resolved before the freeze
  // and has not opened its transaction yet; the lock covers one that has.
  public override async quiesce(organizationId: OrganizationId, node: number): Promise<void> {
    if (this.config.settleMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.config.settleMs));
    }

    // Dropped again after the wait (`CR.10`): a read-through that read the row before the
    // freeze committed could re-cache `frozen: false` after `beginMove` invalidated.
    await this.resolver.invalidate(Shard.keyOf(organizationId));

    const client = this.cluster.at(node).client;
    const names: string[] = [];

    for (const entry of PartitionedTable.TENANT_PARTITIONED) {
      const name = TenantPartitionSeed.partitionName(entry.name, organizationId);
      if (await this.exists(client, name)) names.push(name);
    }

    if (names.length === 0) return;

    // `SHARE` conflicts with the `ROW EXCLUSIVE` every writer holds, so granting it means
    // none is still open. Released at commit: the freeze, not this lock, keeps them out.
    await client.transaction(async (tx) => {
      await tx.execute(sql.raw(`set local lock_timeout = ${QUIESCE_TIMEOUT_MS}`));
      await tx.execute(sql.raw(`set local statement_timeout = ${QUIESCE_TIMEOUT_MS}`));
      await tx.execute(sql.raw(`lock table ${names.join(", ")} in share mode`));
    });
  }

  public override async prepare(
    organizationId: OrganizationId,
    fromNode: number,
    toNode: number,
  ): Promise<void> {
    // `atNode`, not the ambient placement: the seed resolves its own node off scope, and
    // the node this has to prepare is the one the tenant is going *to*.
    const seed = new TenantPartitionSeed(this.cluster, this.scope, this.shards);
    await this.shards.atNode(toNode, () => seed.run(organizationId));

    await this.mirrorMonths(organizationId, fromNode, toNode);

    // Children first, so a sibling key never refuses the delete of its parent. Prunes
    // to the tenant's partition, because `organization_id` is the `LIST` key.
    const target = this.cluster.at(toNode).client;
    for (const table of [...TABLES].reverse()) {
      // A `local` table is never emptied: on the catalog node it holds audit rows and
      // events that exist nowhere else. The copy's `do nothing` walks over what is there.
      if (TablePlacement.of(table) === "local") continue;
      await target.execute(
        sql`delete from ${sql.raw(table)} where organization_id = ${organizationId}`,
      );
    }
  }

  // Page in, page out, keyed on `id`. Every one of these tables has one, and a keyset
  // is what makes a resumed copy read the next page rather than the same one.
  public override async copy(
    organizationId: OrganizationId,
    fromNode: number,
    toNode: number,
  ): Promise<readonly TableRowCount[]> {
    const source = this.cluster.at(fromNode).client;
    const target = this.cluster.at(toNode).client;
    const counts: TableRowCount[] = [];

    for (const table of TABLES) {
      let cursor: string | null = null;
      let rows = 0;

      for (;;) {
        // `to_jsonb(t)`, so a migration that adds a column does not stop it being copied.
        // Native `uuid` order: every key leads with `id`, and `id::text` sorts per page.
        const page: PageResult = await source.execute<PageRow>(sql`
          select t.id::text as id, to_jsonb(t) as row
          from ${sql.raw(table)} t
          where t.organization_id = ${organizationId}
            ${cursor === null ? sql`` : sql`and t.id > ${cursor}::uuid`}
          order by t.id
          limit ${PAGE}
        `);

        if (page.rows.length === 0) break;

        // `do nothing` is for the `local` tables, which `prepare` does not empty: a move
        // back to the catalog node finds the audit rows it copied the first time.
        await target.execute(sql`
          insert into ${sql.raw(table)}
          select * from jsonb_populate_recordset(
            null::${sql.raw(table)},
            ${JSON.stringify(page.rows.map((entry: PageRow) => entry.row))}::jsonb
          )
          on conflict do nothing
        `);

        rows += page.rows.length;
        cursor = page.rows.at(-1)?.id ?? null;
        if (page.rows.length < PAGE) break;
      }

      counts.push({ table, rows });
    }

    return counts;
  }

  // Counted on the node rather than tallied by the copy: the question is what arrived,
  // and a copy reporting on itself cannot answer that.
  public override async counts(
    organizationId: OrganizationId,
    node: number,
  ): Promise<readonly TableRowCount[]> {
    const client = this.cluster.at(node).client;
    const counts: TableRowCount[] = [];

    for (const table of TABLES) {
      const found = await client.execute<{ rows: string }>(sql`
        select count(*)::text as rows from ${sql.raw(table)}
        where organization_id = ${organizationId}
      `);

      counts.push({ table, rows: Number(found.rows[0]?.rows ?? 0) });
    }

    return counts;
  }

  // The time-partitioned `local` tables only, and only rows since `since`. Never the
  // whole tenant again: that would bring back rows the target has since deleted or archived.
  public override async carryAudit(
    organizationId: OrganizationId,
    fromNode: number,
    toNode: number,
    since: Date,
  ): Promise<number> {
    const source = this.cluster.at(fromNode).client;
    const target = this.cluster.at(toNode).client;
    let carried = 0;

    for (const entry of PartitionedTable.TENANT_PARTITIONED) {
      if (TablePlacement.of(entry.name) !== "local" || !entry.column) continue;

      const found = await source.execute<{ row: unknown }>(sql`
        select to_jsonb(t) as row from ${sql.raw(entry.name)} t
        where t.organization_id = ${organizationId}
          and t.${sql.raw(entry.column)} >= ${since.toISOString()}
      `);
      if (found.rows.length === 0) continue;

      const inserted = await target.execute(sql`
        insert into ${sql.raw(entry.name)}
        select * from jsonb_populate_recordset(
          null::${sql.raw(entry.name)},
          ${JSON.stringify(found.rows.map((entry) => entry.row))}::jsonb
        )
        on conflict do nothing
      `);
      carried += inserted.rowCount ?? 0;
    }

    return carried;
  }

  // The same drop `dropTenantPartitions` runs, on a named node; a delete for
  // `outbox_event`, which has no tenant partition to drop.
  public override async dropOn(
    organizationId: OrganizationId,
    node: number,
  ): Promise<readonly string[]> {
    const client = this.cluster.at(node).client;

    // Every table, the catalog node's `activity_log` included: since `24.2a` a catalog
    // write for a moved tenant goes through the outbox, and `carryAudit` ran first.
    const tables = [...PartitionedTable.TENANT_PARTITIONED].reverse().map((entry) => entry.name);

    const dropped = await TenantPartitionSeed.drop(client, [organizationId], tables);

    // Published rows only, and never on the catalog node: its outbox carries every catalog
    // event for the tenant, moved or not. An unpublished row is an event still owed.
    if (node !== CATALOG_NODE) {
      await client.execute(sql`
        delete from outbox_event
        where organization_id = ${organizationId} and published_at is not null
      `);
    }

    return dropped;
  }

  // Every month the source holds, not only the seed's runway: a tenant's older rows
  // need their own month on the target, or the insert has no partition to land in.
  private async mirrorMonths(
    organizationId: OrganizationId,
    fromNode: number,
    toNode: number,
  ): Promise<void> {
    const source = this.cluster.at(fromNode).client;
    const target = this.cluster.at(toNode).client;

    for (const entry of PartitionedTable.TENANT_PARTITIONED) {
      if (!entry.column) continue;

      const tenant = TenantPartitionSeed.partitionName(entry.name, organizationId);
      const children = await source.execute<{ name: string; bound: string }>(sql`
        select c.relname as name, pg_get_expr(c.relpartbound, c.oid) as bound
        from pg_inherits i
        join pg_class c on c.oid = i.inhrelid
        where i.inhparent = to_regclass(${`public.${tenant}`})
      `);

      for (const child of children.rows) {
        if (!IDENTIFIER.test(child.name) || !RANGE_BOUND.test(child.bound)) {
          throw new InternalError(
            new Error(`Unexpected partition ${child.name} ${child.bound} under ${tenant}.`),
          );
        }

        if (await this.exists(target, child.name)) continue;

        // Created standalone and then attached, for the lock reason the seed gives.
        await target.execute(sql.raw(`create table ${child.name} (like ${tenant} including all)`));
        await target.execute(
          sql.raw(`alter table ${tenant} attach partition ${child.name} ${child.bound}`),
        );
      }
    }
  }

  // `to_regclass` returns null rather than throwing, so an absent partition is a skip
  // rather than an error the caller has to tell apart from a real one.
  private async exists(client: DrizzleClient, name: string): Promise<boolean> {
    const probe = await client.execute<{ present: string | null }>(
      sql`select to_regclass(${`public.${name}`})::text as present`,
    );
    return Boolean(probe.rows[0]?.present);
  }
}
