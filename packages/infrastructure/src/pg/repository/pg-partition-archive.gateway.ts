import {
  type ArchivedObject,
  type ArchivedPartition,
  createGzip,
  type DeletedTenantSweep,
  type ExportedObject,
  InternalError,
  type OrganizationId,
  once,
  PartitionArchiveGateway,
  PartitionedTable,
  type PartitionedTableEntry,
  type PartitionedTableName,
  type Placement,
  Readable,
  type SQL,
  type StorageGateway,
  sql,
  type TenantExport,
} from "../../import.js";
import { BaseRepository, type DatabaseCluster } from "../primitive/index.js";
import { partitionArchive } from "../schema/index.js";
import type { ShardScope, TransactionScope } from "../transaction/index.js";

// Rows per round trip out of the detached partition. Large enough that the cursor
// overhead disappears, small enough that one batch is a few megabytes of JSON.
const PAGE = 10_000;

// NDJSON is newline-delimited by definition, so the separator is data rather than
// formatting — naming it keeps a formatter from ever treating it as the latter.
const NEWLINE = "\n";

// The suffix of the index an archive builds on a detached month to walk it by.
const WALK_INDEX = "_walk";

// Where an export lands, and the rule `RetentionRules` writes for it: seven days.
const EXPORT_PREFIX = "export";

// Rows per page when walking a tenant's live table. Smaller than `PAGE`: this runs
// against a table that is still being written to, so each round trip holds less.
const EXPORT_PAGE = 5_000;

// Beyond the seven partitioned tables, the rows a tenant owns in the catalog — and the
// columns each one redacts. A hash is a credential, not data the customer owns.
type ExportTable = {
  readonly name: string;
  readonly keys: readonly string[];
  readonly redacted: readonly string[];
};

const catalogTable = (
  name: string,
  keys: readonly string[],
  redacted: readonly string[] = [],
): ExportTable =>
  Object.freeze({ name, keys: Object.freeze(keys), redacted: Object.freeze(redacted) });

// Exported for the spec that checks each one's keys really are unique within the tenant.
// `role_permissions` was declared on `permission` alone, which repeats once per role.
export const CATALOG_TABLES: readonly ExportTable[] = Object.freeze([
  catalogTable("memberships", ["id"]),
  catalogTable("roles", ["id"]),
  // Both columns of its key past the tenant. Its primary key is `(organization_id,
  // role_id, permission)`, and `permission` alone repeats once per role that holds it.
  catalogTable("role_permissions", ["role_id", "permission"]),
  catalogTable("goal_members", ["id"]),
  catalogTable("permission_overrides", ["id"]),
  catalogTable("invitations", ["id"], ["token_hash"]),
  catalogTable("api_keys", ["id"], ["token_hash"]),
  catalogTable("entitlement_adjustments", ["id"]),
  catalogTable("feature_flag_organizations", ["flag_key"]),
]);

// An alias rather than an interface: drizzle's `execute<T>` constrains `T` to
// `Record<string, unknown>`, and only aliases get an implicit index signature.
type ArchiveRow = {
  sort_key: string;
  id: string;
  action: string | null;
  line: string;
};

type ChildRow = {
  parent: string;
  name: string;
};

// An alias, not an interface, for the reason `ArchiveRow` gives: drizzle's `execute<T>`
// wants an implicit index signature and only aliases have one.
// ──
// One `cursor_<column>` per key column: `role_permissions` pages on two of them,
// because `permission` alone repeats once per role that holds it.
type ExportRow = {
  line: string;
  [cursor: string]: string;
};

interface Cursor {
  readonly sortKey: string;
  readonly id: string;
}

// One tenant-month child and the tenant it belongs to. For a table with no tenant level
// the child is the month itself and the tenant is `NO_TENANT`.
interface Child {
  readonly parent: string;
  readonly name: string;
  readonly organizationId: OrganizationId;
}

export class PgPartitionArchiveGateway extends BaseRepository implements PartitionArchiveGateway {
  // Detaches partitions on whichever node the sweep is walking. Its index rows are
  // the catalog's and go through `catalogDb` — see docs/reference/sharding.md.
  protected override readonly placement: Placement = "local";

  public constructor(
    cluster: DatabaseCluster,
    scope: TransactionScope,
    shards: ShardScope,
    private readonly storage: StorageGateway,
  ) {
    super(cluster, scope, shards);
  }

  // One table-month, one tenant-month child at a time. Each child runs the whole
  // sequence, so a tenant whose upload fails leaves every other tenant archived.
  public async archive(
    table: PartitionedTableName,
    period: Date,
    organizationId?: OrganizationId,
  ): Promise<ArchivedPartition> {
    const entry = PgPartitionArchiveGateway.monthly(table);
    const objects: ArchivedObject[] = [];
    const dropped: string[] = [];

    const children = (await this.childrenOf(entry, period)).filter(
      (child) => !organizationId || child.organizationId === organizationId,
    );

    for (const child of children) {
      const object = await this.archiveChild(table, entry, period, child);
      if (object) objects.push(object);
      dropped.push(child.name);
    }

    return { table, period: PgPartitionArchiveGateway.iso(period), objects, dropped };
  }

  // detach → stream to S3 → record → verify → drop. The order is the job: dropping
  // before verifying is unrecoverable. See docs/reference/cold-storage.md.
  private async archiveChild(
    table: PartitionedTableName,
    entry: PartitionedTableEntry,
    period: Date,
    child: Child,
  ): Promise<ArchivedObject | null> {
    // Everything from the detach to the drop re-attaches on failure: a detached partition
    // is invisible to every query against the parent. The detach is inside too (`CR.15`).
    try {
      // CONCURRENTLY so the parent is not locked against writers while it happens. It
      // cannot run inside a transaction, which is also why this whole method is not one.
      await this.db.execute(
        sql`alter table ${sql.identifier(child.parent)} detach partition ${sql.identifier(child.name)} concurrently`,
      );

      // Counted after the detach, not before: rows written in between would otherwise be
      // streamed to S3 and missing from `row_count`, and the drift is permanent.
      const rowCount = await this.countOf(child.name);
      if (rowCount === 0) {
        // No object and no row. An absent `partition_archive` row means "nothing to
        // restore", never "not archived" — which is why an empty month writes none.
        await this.db.execute(sql`drop table ${sql.identifier(child.name)}`);
        return null;
      }

      return await this.uploadChild(table, entry, period, child, rowCount);
    } catch (error: unknown) {
      await this.reattach(child, period);
      throw error;
    }
  }

  // The middle three steps and the two streams they need stopped on the way out. Split
  // from the unwind above so an empty month never builds a stream at all.
  private async uploadChild(
    table: PartitionedTableName,
    entry: PartitionedTableEntry,
    period: Date,
    child: Child,
    rowCount: number,
  ): Promise<ArchivedObject> {
    const key = PgPartitionArchiveGateway.objectKey(table, period, child.organizationId);
    const actionCounts: Record<string, number> = {};

    // The walk's own index, on the detached table and dropped with it (`CR.23`). Only
    // `activity_log` has one; elsewhere every page re-sorted the month from its start.
    if (rowCount > PAGE) {
      await this.direct.client.execute(
        sql.raw(
          `create index if not exists ${child.name}${WALK_INDEX} on ${child.name} (${entry.column}, id)`,
        ),
      );
    }

    // Built before the try so the failure path can stop them. `Readable.from` pulls as
    // soon as it is piped, and a rejected upload leaves it paging a partition nobody reads.
    const source = Readable.from(this.rows(entry, child.name, actionCounts));
    // Gzipped in between the database and S3 rather than at either end: neither ever
    // holds the month.
    const body = source.pipe(createGzip());

    try {
      // NDJSON, so ClickHouse reads it back with `s3(…, 'JSONEachRow', …)` directly.
      const stored = await this.storage.putStream(key, body, "application/x-ndjson+gzip");

      const object: ArchivedObject = {
        organizationId: child.organizationId,
        key: stored.key,
        rowCount,
        bytes: stored.size,
        checksum: stored.checksum,
        actionCounts,
      };

      // Recorded before anything is destroyed.
      await this.record(table, period, object);

      // The length, not existence. A multipart upload that lost a part answers the same
      // `HEAD`, so the only pre-drop check passed on an object that was already short.
      const length = await this.storage.sizeOf(stored.key);
      if (length !== stored.size) {
        throw new Error(
          `Archive object is ${length ?? "missing"} bytes, expected ${stored.size}: ${stored.key}`,
        );
      }

      await this.db.execute(sql`drop table ${sql.identifier(child.name)}`);

      return object;
    } catch (error: unknown) {
      await PgPartitionArchiveGateway.stop(source, body);
      throw error;
    }
  }

  private async record(
    table: PartitionedTableName,
    period: Date,
    object: ArchivedObject,
  ): Promise<void> {
    await this.catalogDb
      .insert(partitionArchive)
      .values({
        organizationId: object.organizationId,
        tableName: table,
        period: PgPartitionArchiveGateway.iso(period),
        objectKey: object.key,
        rowCount: object.rowCount,
        bytes: object.bytes,
        checksum: object.checksum,
        actionCounts: object.actionCounts,
      })
      .onConflictDoUpdate({
        target: [
          partitionArchive.organizationId,
          partitionArchive.tableName,
          partitionArchive.period,
        ],
        set: {
          objectKey: object.key,
          rowCount: object.rowCount,
          bytes: object.bytes,
          checksum: object.checksum,
          actionCounts: object.actionCounts,
        },
      });
  }

  // Objects first, rows second. A crash between the two leaves a row pointing at a
  // deleted object, which re-runs cleanly; the other order leaves an orphan forever.
  public async sweep(organizationId: OrganizationId): Promise<number> {
    const rows = await this.catalogDb.execute<{ object_key: string }>(
      sql`select object_key from partition_archive where organization_id = ${organizationId}::uuid`,
    );

    for (const row of rows.rows) await this.storage.delete(row.object_key);

    await this.catalogDb.execute(
      sql`delete from partition_archive where organization_id = ${organizationId}::uuid`,
    );

    return rows.rows.length;
  }

  // Live rows, never detached: an export must not take the tenant's data offline. One
  // object per tenant-owned table, plus the catalog, plus a manifest.
  public async exportTenant(organizationId: OrganizationId, day: Date): Promise<TenantExport> {
    const stamp = PgPartitionArchiveGateway.iso(day);
    const objects: ExportedObject[] = [];

    for (const entry of PartitionedTable.TENANT_PARTITIONED) {
      const object = await this.exportTable(
        organizationId,
        stamp,
        catalogTable(entry.name, ["id"]),
      );
      if (object) objects.push(object);
    }

    for (const table of CATALOG_TABLES) {
      const object = await this.exportTable(organizationId, stamp, table);
      if (object) objects.push(object);
    }

    const manifestKey = `${EXPORT_PREFIX}/${organizationId}/${stamp}/manifest.json`;
    const manifest = await this.storage.put(
      manifestKey,
      Buffer.from(`${JSON.stringify({ organizationId, day: stamp, objects }, null, 2)}\n`),
      "application/json",
    );

    return { organizationId, day: stamp, objects, manifestKey: manifest.key };
  }

  // Null for a table the tenant has no rows in: an absent object is "nothing to
  // export", and writing an empty one would put a gzip header in every manifest.
  private async exportTable(
    organizationId: OrganizationId,
    stamp: string,
    table: ExportTable,
  ): Promise<ExportedObject | null> {
    const counted = { rows: 0 };
    const source = Readable.from(this.exportRows(organizationId, table, counted));
    const body = source.pipe(createGzip());
    const objectKey = `${EXPORT_PREFIX}/${organizationId}/${stamp}/${table.name}.ndjson.gz`;

    try {
      const stored = await this.storage.putStream(objectKey, body, "application/x-ndjson+gzip");

      if (counted.rows === 0) {
        // Deleted rather than not written: the row count is only known once the stream
        // has drained, and draining it is what the upload does.
        await this.storage.delete(stored.key);
        return null;
      }

      return {
        table: table.name,
        key: stored.key,
        rowCount: counted.rows,
        bytes: stored.size,
        checksum: stored.checksum,
      };
    } catch (error: unknown) {
      await PgPartitionArchiveGateway.stop(source, body);
      throw error;
    }
  }

  // Keyset on the columns unique within the tenant — plural, because `role_permissions`
  // needs two and `permission` alone repeats once per role that holds it.
  // ──
  // `OFFSET` would re-scan the table once per page and skip rows written in between.
  private async *exportRows(
    organizationId: OrganizationId,
    table: ExportTable,
    counted: { rows: number },
  ): AsyncGenerator<Uint8Array> {
    const encoder = new TextEncoder();
    // Compared and ordered on the native columns, so the key's index serves the walk. Cast
    // to text, it defeated the key and every page sorted the whole table (`CR.24`).
    const columns = table.keys.map((key) => sql`t.${sql.identifier(key)}`);
    const ordering = sql.join(columns, sql`, `);
    // Text only on the way out, to carry the cursor; the comparison casts it back.
    const selected = sql.join(
      table.keys.map(
        (key, index) =>
          sql`${columns[index] ?? sql`null`}::text as ${sql.identifier(`cursor_${key}`)}`,
      ),
      sql`, `,
    );
    let after: readonly string[] | null = null;

    for (;;) {
      // A row constructor, so two columns compare as one pair rather than independently.
      // Annotated: a ternary between two `sql` templates infers back as an implicit `any`.
      const keyset: SQL =
        after === null
          ? sql``
          : sql`and (${ordering}) > (${sql.join(
              after.map((value) => sql`${value}`),
              sql`, `,
            )})`;

      const page: ExportRow[] = (
        await this.db.execute<ExportRow>(
          sql`select row_to_json(t)::text as line, ${selected}
              from ${sql.identifier(table.name)} t
              where t.organization_id = ${organizationId}::uuid ${keyset}
              order by ${ordering} limit ${EXPORT_PAGE}`,
        )
      ).rows;

      if (page.length === 0) return;

      for (const row of page) {
        counted.rows += 1;
        yield encoder.encode(
          `${PgPartitionArchiveGateway.redact(row.line, table.redacted)}${NEWLINE}`,
        );
      }

      const last = page[page.length - 1];
      if (!last || page.length < EXPORT_PAGE) return;
      after = table.keys.map((key) => String(last[`cursor_${key}`]));
    }
  }

  // Re-serialised rather than string-replaced: a token hash is base64 and a naive
  // replace over the JSON would also hit a column that happens to contain it.
  private static redact(line: string, redacted: readonly string[]): string {
    if (redacted.length === 0) return line;

    const row = JSON.parse(line) as Record<string, unknown>;
    for (const field of redacted) {
      if (field in row) row[field] = null;
    }

    return JSON.stringify(row);
  }

  // The tombstone every row of a deleted tenant carries. Written once, at the delete,
  // so the recovery window runs from then rather than from when a month was archived.
  public async markTenantDeleted(organizationId: OrganizationId, at: Date): Promise<number> {
    const marked = await this.catalogDb.execute(
      sql`update partition_archive
          set deleted_at = ${at.toISOString()}::timestamptz
          where organization_id = ${organizationId}::uuid
            and deleted_at is null`,
    );

    return marked.rowCount ?? 0;
  }

  // Keyed on the tombstone, never on `archived_at`: a tenant with a year of cold months
  // lost all but the newest the night after the delete. See docs/reference/cold-storage.md.
  public async sweepDeleted(before: Date): Promise<DeletedTenantSweep> {
    const rows = await this.catalogDb.execute<{ organization_id: string; object_key: string }>(
      sql`select pa.organization_id, pa.object_key
          from partition_archive pa
          where pa.deleted_at is not null
            and pa.deleted_at < ${before.toISOString()}::timestamptz
            and not exists (select 1 from organizations o where o.id = pa.organization_id)`,
    );

    const organizations = new Set<string>();
    for (const row of rows.rows) {
      await this.storage.delete(row.object_key);
      organizations.add(row.organization_id);
      // One row at a time, after its object: a crash leaves a row pointing at a
      // deleted object, which re-runs cleanly, rather than an orphan nothing names.
      await this.catalogDb.execute(
        sql`delete from partition_archive
            where organization_id = ${row.organization_id}::uuid
              and object_key = ${row.object_key}`,
      );
    }

    return { organizations: organizations.size, objects: rows.rows.length };
  }

  // Awaited, not only asked for: `destroy()` returns before the page already in flight
  // does, and the caller drops the partition the moment this method throws.
  private static async stop(source: Readable, body: Readable): Promise<void> {
    body.destroy();
    if (source.destroyed) return;
    source.destroy();

    try {
      await once(source, "close");
    } catch {
      // Swallowed for the same reason `reattach` swallows: the caller is waiting on the
      // failure that started this, not on why the cursor would not close.
    }
  }

  // Puts the partition back where it was, so a failed run leaves the table as it found
  // it. Best effort: a re-attach that itself fails must not replace the real error.
  private async reattach(child: Child, period: Date): Promise<void> {
    try {
      // A cancelled `detach … concurrently` leaves the partition *detach-pending*: still a
      // child, so `attach` is not the inverse, and no row in the month can be read or written.
      if (await this.isDetachPending(child.name)) {
        await this.db.execute(
          sql.raw(`alter table ${child.parent} detach partition ${child.name} finalize`),
        );
      }
      // Still a child when the detach itself was what failed; there is nothing to undo.
      if (!(await this.isStandalone(child.name))) return;

      await this.db.execute(sql.raw(`drop index if exists ${child.name}${WALK_INDEX}`));
      await this.attach(child, period);
    } catch {
      // Swallowed on purpose: the caller needs the failure that started this, and a
      // partition that will not re-attach is an operator's problem either way.
    }
  }

  // `sql.raw`, because Postgres accepts no bind parameters in DDL — the same trap
  // `PgMaintenanceGateway` documents. Both bounds are derived from a `Date`.
  private async attach(child: Child, period: Date): Promise<void> {
    const from = PgPartitionArchiveGateway.iso(period);
    const to = PgPartitionArchiveGateway.iso(PgPartitionArchiveGateway.nextMonth(period));
    await this.db.execute(
      sql.raw(
        `alter table ${child.parent} attach partition ${child.name} for values from ('${from}') to ('${to}')`,
      ),
    );
  }

  private async isStandalone(name: string): Promise<boolean> {
    const result = await this.db.execute<{ standalone: boolean }>(sql`
      select to_regclass(${`public.${name}`}) is not null and not exists (
        select 1 from pg_inherits where inhrelid = to_regclass(${`public.${name}`})
      ) as standalone
    `);
    return result.rows[0]?.standalone === true;
  }

  // `inhdetachpending` is the only thing that distinguishes a half-detached partition from
  // an attached one, and the difference is a month that silently accepts no writes.
  private async isDetachPending(name: string): Promise<boolean> {
    const result = await this.db.execute<{ pending: boolean }>(sql`
      select inhdetachpending as pending
      from pg_inherits
      where inhrelid = ${`public.${name}`}::regclass
    `);

    return result.rows[0]?.pending === true;
  }

  // From the catalog rather than from `organizations`: a partition whose tenant row is
  // already gone still holds rows, and this is the loop that has to find it.
  private async childrenOf(entry: PartitionedTableEntry, period: Date): Promise<readonly Child[]> {
    const suffix = `_${PgPartitionArchiveGateway.monthSuffix(period)}`;

    if (!entry.tenantKey) {
      const rows = await this.db.execute<ChildRow>(sql`
        select root.relname as parent, child.relname as name
        from pg_class root
        join pg_inherits mi on mi.inhparent = root.oid
        join pg_class child on child.oid = mi.inhrelid
        where root.relname = ${entry.name} and child.relname = root.relname || ${suffix}
      `);

      return rows.rows.map((row) => ({
        parent: row.parent,
        name: row.name,
        organizationId: PartitionArchiveGateway.NO_TENANT,
      }));
    }

    const rows = await this.db.execute<ChildRow>(sql`
      select tenant.relname as parent, child.relname as name
      from pg_class root
      join pg_inherits ti on ti.inhparent = root.oid
      join pg_class tenant on tenant.oid = ti.inhrelid
      join pg_inherits mi on mi.inhparent = tenant.oid
      join pg_class child on child.oid = mi.inhrelid
      where root.relname = ${entry.name} and child.relname = tenant.relname || ${suffix}
      order by tenant.relname
    `);

    return rows.rows.map((row) => ({
      parent: row.parent,
      name: row.name,
      organizationId: PgPartitionArchiveGateway.tenantOf(entry.name, row.parent),
    }));
  }

  private async countOf(name: string): Promise<number> {
    const result = await this.db.execute<{ count: string }>(
      sql`select count(*)::text as count from ${sql.identifier(name)}`,
    );
    return Number(result.rows[0]?.count ?? 0);
  }

  // Keyset on the partition's own primary key, so a month that does not fit in memory
  // never has to. `OFFSET` would re-scan everything it already returned.
  private async *rows(
    entry: PartitionedTableEntry,
    name: string,
    actionCounts: Record<string, number>,
  ): AsyncGenerator<Uint8Array> {
    const encoder = new TextEncoder();
    const column = sql.identifier(entry.column ?? "");
    // Only `activity_log` has one, and the breakdown is what lets a cold reconciliation
    // subtract an excluded action without reading the object back.
    const action =
      entry.name === PartitionedTable.ACTIVITY_LOG
        ? sql`t.action::text as action`
        : sql`null::text as action`;
    let after: Cursor | null = null;

    for (;;) {
      // Built as a variable rather than inline: a ternary between two `sql` templates
      // infers through `after` and back, which the compiler reports as an implicit `any`.
      const keyset =
        after === null
          ? sql``
          : sql`where (t.${column}, t.id) > (${after.sortKey}::timestamptz, ${after.id}::uuid)`;

      const page: ArchiveRow[] = (
        await this.db.execute<ArchiveRow>(
          sql`select t.${column}::text as sort_key, t.id::text as id, ${action},
                     row_to_json(t)::text as line
              from ${sql.identifier(name)} t
              ${keyset}
              order by t.${column}, t.id
              limit ${PAGE}`,
        )
      ).rows;

      if (page.length === 0) return;

      for (const row of page) {
        if (row.action === null) continue;
        actionCounts[row.action] = (actionCounts[row.action] ?? 0) + 1;
      }

      yield encoder.encode(`${page.map((row) => row.line).join(NEWLINE)}${NEWLINE}`);

      const last = page[page.length - 1];
      if (!last || page.length < PAGE) return;
      after = { sortKey: last.sort_key, id: last.id };
    }
  }

  // Total over the allowlist rather than a cast: a table with no month level has no
  // partition this gateway could archive, and saying so beats a wrong `drop table`.
  private static monthly(table: PartitionedTableName): PartitionedTableEntry {
    const entry = PartitionedTable.byName(table);
    if (!entry.column) throw new InternalError(new Error(`${table} has no month level`));
    return entry;
  }

  // `<table>_<32hex>` back to a uuid. Read off the catalog name rather than passed in,
  // so a partition whose tenant row is gone still reports whose it was.
  private static tenantOf(table: string, parent: string): OrganizationId {
    const hex = parent.slice(table.length + 1);
    const match = /^([0-9a-f]{8})([0-9a-f]{4})([0-9a-f]{4})([0-9a-f]{4})([0-9a-f]{12})$/.exec(hex);
    if (!match) throw new InternalError(new Error(`Not a tenant partition: ${parent}`));
    return match.slice(1).join("-") as OrganizationId;
  }

  private static nextMonth(period: Date): Date {
    return new Date(Date.UTC(period.getUTCFullYear(), period.getUTCMonth() + 1, 1));
  }

  private static monthSuffix(period: Date): string {
    return `${period.getUTCFullYear()}_${String(period.getUTCMonth() + 1).padStart(2, "0")}`;
  }

  // `cold/` rather than a per-table prefix: one S3 lifecycle rule on it tiers every
  // table without naming an object, which is why the layout is fixed at all.
  private static objectKey(table: string, period: Date, organizationId: OrganizationId): string {
    const month = String(period.getUTCMonth() + 1).padStart(2, "0");
    return `cold/${table}/${period.getUTCFullYear()}/${month}/${organizationId}.ndjson.gz`;
  }

  private static iso(value: Date): string {
    return value.toISOString().slice(0, 10);
  }
}
