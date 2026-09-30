import {
  type ArchivedObject,
  type ArchivedPartition,
  ConflictError,
  createGzip,
  createHash,
  type DeletedTenantSweep,
  type ExportedObject,
  InternalError,
  NotFoundError,
  type OrganizationId,
  once,
  type PartitionArchiveEntry,
  PartitionArchiveGateway,
  PartitionedTable,
  type PartitionedTableEntry,
  type PartitionedTableName,
  type Placement,
  type ProjectionGap,
  Readable,
  type RestoredMonth,
  type SQL,
  type StorageGateway,
  sql,
  type TenantExport,
} from "../../import.js";
import { NdjsonLines } from "../../s3/index.js";
import { BaseRepository, type DatabaseCluster } from "../primitive/index.js";
import { partitionArchive } from "../schema/index.js";
import type { ShardScope, TransactionScope } from "../transaction/index.js";

// Rows per round trip out of the detached partition. Large enough that the cursor
// overhead disappears, small enough that one batch is a few megabytes of JSON.
const PAGE = 10_000;

// Rows per insert on the way back in. Smaller than `PAGE`: a restore hands Postgres one
// JSON parameter per batch, and the server parses the whole thing before it writes a row.
const RESTORE_BATCH = 5_000;

// NDJSON is newline-delimited by definition, so the separator is data rather than
// formatting — naming it keeps a formatter from ever treating it as the latter.
const NEWLINE = "\n";

// The suffix of the index an archive builds on a detached month to walk it by.
const WALK_INDEX = "_walk";

// Postgres truncates an identifier past this, and a truncated scratch table collides
// silently with the next tenant's.
const MAX_IDENTIFIER = 63;

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

// `bytes` comes back as text because it is a `bigint`: the driver would hand back a
// string anyway, and asking for one is what makes that explicit.
type EntryRow = {
  organization_id: string;
  table_name: string;
  period: string;
  object_key: string;
  row_count: number;
  bytes: string;
  checksum: string;
  action_counts: Record<string, number>;
  projected_at: string | null;
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

  // `CR.15`. A run cut off between the detach and the drop left the month detach-pending,
  // which made every later run throw, or standalone, which no query and no run could see.
  public async recover(table: PartitionedTableName): Promise<readonly string[]> {
    const entry = PgPartitionArchiveGateway.monthly(table);

    for (const child of await this.pendingOf(entry)) {
      await this.db.execute(
        sql.raw(`alter table ${child.parent} detach partition ${child.name} finalize`),
      );
    }

    const recovered: string[] = [];
    for (const orphan of await this.orphansOf(entry)) {
      const period = PgPartitionArchiveGateway.periodOf(orphan.name);
      await this.db.execute(sql.raw(`drop index if exists ${orphan.name}${WALK_INDEX}`));
      await this.attach(orphan, period);
      recovered.push(orphan.name);
    }
    return recovered;
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

  // Into a scratch table, never the live parent: a re-attached month puts archived rows
  // back in the hot database and leaves the retention job arguing with itself.
  public async restore(
    table: PartitionedTableName,
    period: Date,
    organizationId: OrganizationId,
  ): Promise<RestoredMonth> {
    const entry = PgPartitionArchiveGateway.monthly(table);
    const iso = PgPartitionArchiveGateway.iso(period);
    const archived = await this.archivedOf(table, iso, organizationId);

    const child = PgPartitionArchiveGateway.childName(entry, period, organizationId);
    const scratch = PgPartitionArchiveGateway.scratchName(child);

    // Dropped rather than appended to: a previous restore of the same month is evidence
    // of that restore, and two runs merged into one table are evidence of neither.
    await this.db.execute(sql`drop table if exists ${sql.identifier(scratch)}`);
    await this.db.execute(sql.raw(`create table ${scratch} (like ${entry.name} including all)`));

    // Streamed a batch at a time (`CR.16`): gunzipped whole and split, a large month OOMed
    // the worker or passed V8's string limit. Hashed on the way through, as it was stored.
    const hash = createHash("sha256");
    let batch: string[] = [];
    let lines = 0;
    for await (const line of NdjsonLines.of(this.storage.getStream(archived.key), hash)) {
      batch.push(line);
      lines += 1;
      if (batch.length < RESTORE_BATCH) continue;
      await this.insertBatch(scratch, batch);
      batch = [];
    }
    if (batch.length > 0) await this.insertBatch(scratch, batch);

    // A scratch table from an object that rotted is not a restore, so it does not stay.
    if (hash.digest("hex") !== archived.checksum || lines !== archived.rowCount) {
      await this.db.execute(sql`drop table if exists ${sql.identifier(scratch)}`);
      throw new ConflictError("cold", "checksum");
    }

    return {
      table,
      period: iso,
      organizationId,
      scratchTable: scratch,
      rowCount: await this.countOf(scratch),
    };
  }

  // `where projected_at is null`, so a second run over the same month is a no-op rather
  // than a stamp that moves. The partial index is what makes the predicate free.
  public async markProjected(
    table: PartitionedTableName,
    period: Date,
    organizationId: OrganizationId,
  ): Promise<void> {
    await this.catalogDb.execute(
      sql`update partition_archive set projected_at = now()
          where organization_id = ${organizationId}::uuid
            and table_name = ${table}
            and period = ${PgPartitionArchiveGateway.iso(period)}::date
            and projected_at is null`,
    );
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

  // Leads with the tenant, which is what the primary key is ordered by — so this is a
  // range scan on one tenant rather than a filter over every month ever archived.
  public async monthsOf(
    table: PartitionedTableName,
    organizationId: OrganizationId,
  ): Promise<readonly PartitionArchiveEntry[]> {
    const rows = await this.catalogDb.execute<EntryRow>(
      sql`select organization_id::text as organization_id, table_name, period::text as period,
                 object_key,
                 row_count, bytes::bigint::text as bytes, checksum, action_counts, projected_at
          from partition_archive
          where organization_id = ${organizationId}::uuid and table_name = ${table}
          order by period`,
    );

    return rows.rows.map((row) => PgPartitionArchiveGateway.entryOf(row, table));
  }

  // Reads the partial index on `(table_name, period) where projected_at is null`, which
  // is what keeps this off a scan over every tenant-month ever archived.
  public async gaps(table: PartitionedTableName): Promise<readonly ProjectionGap[]> {
    const rows = await this.catalogDb.execute<{ period: string; tenants: string; rows: string }>(
      sql`select period::text as period,
                 count(*)::text as tenants,
                 coalesce(sum(row_count), 0)::text as rows
          from partition_archive
          where table_name = ${table} and projected_at is null
          group by period
          order by period`,
    );

    return rows.rows.map((row) => ({
      tableName: table,
      period: row.period,
      tenants: Number(row.tenants),
      rows: Number(row.rows),
    }));
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

  // No `storage.delete()`, and that is the whole difference from `sweep`: the bucket
  // expired these objects itself, so deleting them again is a round trip per row.
  public async forget(table: PartitionedTableName, before: Date): Promise<number> {
    const result = await this.catalogDb.execute(
      sql`delete from partition_archive
          where table_name = ${table}
            and period < ${PgPartitionArchiveGateway.iso(before)}::date`,
    );

    return result.rowCount ?? 0;
  }

  // Ordered by tenant, so a restore of a whole month walks them in a stable order and
  // two runs log the same sequence.
  public async entriesFor(
    table: PartitionedTableName,
    period: string,
    organizationId?: OrganizationId,
  ): Promise<readonly PartitionArchiveEntry[]> {
    const tenant = organizationId ? sql`and organization_id = ${organizationId}::uuid` : sql``;

    const rows = await this.catalogDb.execute<EntryRow>(
      sql`select organization_id::text as organization_id, table_name, period::text as period,
                 object_key, row_count, bytes::bigint::text as bytes, checksum,
                 action_counts, projected_at
          from partition_archive
          where table_name = ${table} and period = ${period}::date ${tenant}
          order by organization_id`,
    );

    return rows.rows.map((row) => PgPartitionArchiveGateway.entryOf(row, table));
  }

  // One mapper for both reads: two copies drifted the moment `projected_at` was added.
  private static entryOf(row: EntryRow, table: PartitionedTableName): PartitionArchiveEntry {
    return {
      organizationId: row.organization_id as OrganizationId,
      tableName: table,
      period: row.period,
      objectKey: row.object_key,
      rowCount: Number(row.row_count),
      bytes: Number(row.bytes),
      checksum: row.checksum,
      actionCounts: row.action_counts,
      projectedAt: row.projected_at === null ? null : new Date(row.projected_at),
    };
  }

  // The key, and the two facts that prove the object is the one this row recorded.
  private async archivedOf(
    table: PartitionedTableName,
    period: string,
    organizationId: OrganizationId,
  ): Promise<{ key: string; checksum: string; rowCount: number }> {
    const rows = await this.catalogDb.execute<{
      object_key: string;
      checksum: string;
      row_count: number;
    }>(
      sql`select object_key, checksum, row_count from partition_archive
          where organization_id = ${organizationId}::uuid
            and table_name = ${table}
            and period = ${period}::date`,
    );

    const row = rows.rows[0];
    if (!row) throw new NotFoundError("cold", `${table}/${period}/${organizationId}`);

    return { key: row.object_key, checksum: row.checksum, rowCount: Number(row.row_count) };
  }

  // Handed to Postgres as one JSON array, so the lines never become objects here at all.
  private async insertBatch(scratch: string, lines: readonly string[]): Promise<void> {
    await this.db.execute(
      sql`insert into ${sql.identifier(scratch)}
          select * from json_populate_recordset(null::${sql.identifier(scratch)},
                                                ${`[${lines.join(",")}]`}::json)`,
    );
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

  // Every month of the table still half-detached, whichever run left it so.
  private async pendingOf(entry: PartitionedTableEntry): Promise<readonly Child[]> {
    const rows = await this.db.execute<ChildRow>(sql`
      select parent.relname as parent, child.relname as name
      from pg_inherits i
      join pg_class parent on parent.oid = i.inhparent
      join pg_class child on child.oid = i.inhrelid
      where i.inhdetachpending
        and (parent.relname = ${entry.name} or exists (
          select 1 from pg_inherits ti join pg_class root on root.oid = ti.inhparent
          where ti.inhrelid = parent.oid and root.relname = ${entry.name}
        ))
    `);
    return rows.rows.map((row) => ({
      parent: row.parent,
      name: row.name,
      organizationId: PartitionArchiveGateway.NO_TENANT,
    }));
  }

  // A table named as a month of this one — `<parent>_<yyyy>_<mm>` — that is nobody's
  // partition. The `_restore` scratch tables do not end in a month, so never match.
  private async orphansOf(entry: PartitionedTableEntry): Promise<readonly Child[]> {
    const parents = entry.tenantKey
      ? sql`select tenant.relname as name from pg_class root
            join pg_inherits ti on ti.inhparent = root.oid
            join pg_class tenant on tenant.oid = ti.inhrelid
            where root.relname = ${entry.name}`
      : sql`select ${entry.name}::text as name`;

    const rows = await this.db.execute<ChildRow>(sql`
      select parent.name as parent, orphan.relname as name
      from (${parents}) parent
      join pg_class orphan
        on orphan.relkind = 'r'
       and orphan.relname ~ ('^' || parent.name || '_[0-9]{4}_[0-9]{2}$')
      join pg_namespace ns on ns.oid = orphan.relnamespace and ns.nspname = 'public'
      where not exists (select 1 from pg_inherits i where i.inhrelid = orphan.oid)
    `);
    return rows.rows.map((row) => ({
      parent: row.parent,
      name: row.name,
      organizationId: PartitionArchiveGateway.NO_TENANT,
    }));
  }

  // `<name>_<yyyy>_<mm>` back to the first of that month.
  private static periodOf(name: string): Date {
    const match = /_(\d{4})_(\d{2})$/.exec(name);
    if (!match) throw new InternalError(new Error(`Not a month partition: ${name}`));
    return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, 1));
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

  private static childName(
    entry: PartitionedTableEntry,
    period: Date,
    organizationId: OrganizationId,
  ): string {
    const suffix = PgPartitionArchiveGateway.monthSuffix(period);
    if (!entry.tenantKey) return `${entry.name}_${suffix}`;

    const hex = organizationId.replaceAll("-", "").toLowerCase();
    if (!/^[0-9a-f]{32}$/.test(hex)) {
      throw new InternalError(new Error(`Not an organization id: ${organizationId}`));
    }
    return `${entry.name}_${hex}_${suffix}`;
  }

  // The partition's own name plus a suffix, so what a scratch table holds is legible
  // from its name and two restores of different months never collide.
  private static scratchName(child: string): string {
    const name = `${child}_restore`;
    if (name.length > MAX_IDENTIFIER) {
      throw new InternalError(new Error(`Scratch table name too long: ${name}`));
    }
    return name;
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
