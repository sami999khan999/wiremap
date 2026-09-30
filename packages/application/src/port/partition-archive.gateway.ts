import type { OrganizationId } from "../import.js";
import type { PartitionedTableName } from "../primitive/index.js";
import type { PartitionArchiveEntry } from "./cold-archive.reader.js";

// One tenant's month, as it landed in cold storage. `bytes` is the stored size, which is
// the only place this system records what an object costs.
export interface ArchivedObject {
  readonly organizationId: OrganizationId;
  readonly key: string;
  readonly rowCount: number;
  readonly bytes: number;
  readonly checksum: string;
  // `{ "<action>": n }`, counted while the rows stream out. Empty for a table with no
  // `action` column, which is every table but `activity_log`.
  readonly actionCounts: Readonly<Record<string, number>>;
}

// One table-month across every tenant. `dropped` names the partitions that are gone,
// which is not `objects`: an empty tenant-month writes no object and is still dropped.
export interface ArchivedPartition {
  readonly table: PartitionedTableName;
  // ISO `YYYY-MM-DD`, the first of the archived month — a third of the primary key of
  // `partition_archive`, and the same string a replay is asked for.
  readonly period: string;
  readonly objects: readonly ArchivedObject[];
  readonly dropped: readonly string[];
}

// Where a restored tenant-month landed. Never the live parent: a re-attached month puts
// archived rows back in the hot database and leaves retention arguing with itself.
export interface RestoredMonth {
  readonly table: PartitionedTableName;
  readonly period: string;
  readonly organizationId: OrganizationId;
  readonly scratchTable: string;
  readonly rowCount: number;
}

// One object of one export. `table` is the tenant-owned table it holds, or `catalog`
// for the eighth object, which is every row the seven do not cover.
export interface ExportedObject {
  readonly table: string;
  readonly key: string;
  readonly rowCount: number;
  readonly bytes: number;
  readonly checksum: string;
}

export interface TenantExport {
  readonly organizationId: OrganizationId;
  // `YYYY-MM-DD`, in the key. Two exports on one day replace each other, which is what
  // an operator retrying a download means.
  readonly day: string;
  readonly objects: readonly ExportedObject[];
  // Counts and checksums for every object above, as a ninth object. It is what makes a
  // download verifiable without this system.
  readonly manifestKey: string;
}

// One archived month that the derived store never fully received. `tenants` is how many
// of that month's objects carry a null `projected_at`, not how many exist.
export interface ProjectionGap {
  readonly tableName: string;
  readonly period: string;
  readonly tenants: number;
  readonly rows: number;
}

// Counted two ways, because they answer different questions: how many customers this
// finally forgot, and how many objects the bucket stopped being billed for.
export interface DeletedTenantSweep {
  readonly organizations: number;
  readonly objects: number;
}

// Cold storage for every partitioned table. Without it, retention means deletion: a
// month older than the window is gone rather than somewhere cheaper.
export abstract class PartitionArchiveGateway {
  // The organization a table with no tenant level records its month under. The nil uuid
  // names no row, which is what makes it readable as "this object spans every tenant".
  public static readonly NO_TENANT = "00000000-0000-0000-0000-000000000000" as OrganizationId;

  // Detach, upload, record, verify, drop — once per tenant-month child; dropping before
  // verifying is unrecoverable. `organizationId` narrows it, which an override needs.
  public abstract archive(
    table: PartitionedTableName,
    period: Date,
    organizationId?: OrganizationId,
  ): Promise<ArchivedPartition>;

  // Months a cut-off `archive` left detached, attached again so they are readable and
  // archived on the next pass. Run before the months are listed. Returns their names.
  public abstract recover(table: PartitionedTableName): Promise<readonly string[]>;

  // Back out of cold storage into a scratch table. An archive nobody has restored is a
  // deletion with extra steps, which is why this is a method rather than a runbook.
  public abstract restore(
    table: PartitionedTableName,
    period: Date,
    organizationId: OrganizationId,
  ): Promise<RestoredMonth>;

  // Null `projected_at` means the derived store never received that tenant-month. This
  // is the only thing that clears one, and it never clears one twice.
  public abstract markProjected(
    table: PartitionedTableName,
    period: Date,
    organizationId: OrganizationId,
  ): Promise<void>;

  // Objects first, rows second: a crash leaves a row pointing at a deleted object, which
  // is re-runnable, rather than an object nothing points at, which is invisible forever.
  public abstract sweep(organizationId: OrganizationId): Promise<number>;

  // Every archived month of one tenant, oldest first. The cold half of the
  // reconciliation reads this; the primary key makes it one row per month.
  public abstract monthsOf(
    table: PartitionedTableName,
    organizationId: OrganizationId,
  ): Promise<readonly PartitionArchiveEntry[]>;

  // The partial index's whole purpose: "what has a hole" as an index read rather than
  // a scan over every tenant-month this system has ever archived.
  public abstract gaps(table: PartitionedTableName): Promise<readonly ProjectionGap[]>;

  // Live rows, never detached: an export must not take the tenant's data offline while
  // it runs. One object per tenant-owned table, plus the catalog, plus the manifest.
  public abstract exportTenant(organizationId: OrganizationId, day: Date): Promise<TenantExport>;

  // The tombstone the recovery window is measured from. Stamped when the tenant is
  // deleted, because `archived_at` dates the month rather than the deletion.
  public abstract markTenantDeleted(organizationId: OrganizationId, at: Date): Promise<number>;

  // Every tenant deleted before `before`, read off the tombstone. The delay is
  // deliberate: a deletion is recoverable for exactly that long.
  public abstract sweepDeleted(before: Date): Promise<DeletedTenantSweep>;

  // Rows only. The bucket's lifecycle rule deletes the object, and a row still pointing
  // at one it already expired is a `NotFoundError` on a read that should be empty.
  public abstract forget(table: PartitionedTableName, before: Date): Promise<number>;

  // The index, read back. Every tenant that has a row for the month when no
  // organization is named, which is what an operator means by "restore March".
  public abstract entriesFor(
    table: PartitionedTableName,
    period: string,
    organizationId?: OrganizationId,
  ): Promise<readonly PartitionArchiveEntry[]>;
}
