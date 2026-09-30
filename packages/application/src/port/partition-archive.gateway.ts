import type { OrganizationId } from "../import.js";
import type { PartitionedTableName } from "../primitive/index.js";

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

// Counted two ways, because they answer different questions: how many customers this
// finally forgot, and how many objects the bucket stopped being billed for.
export interface DeletedTenantSweep {
  readonly organizations: number;
  readonly objects: number;
}

// Cold storage for a deleted tenant's rows, and the tenant export. Lite archives only on
// a delete, so the delete is recoverable for as long as the sweep waits.
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

  // Objects first, rows second: a crash leaves a row pointing at a deleted object, which
  // is re-runnable, rather than an object nothing points at, which is invisible forever.
  public abstract sweep(organizationId: OrganizationId): Promise<number>;

  // Live rows, never detached: an export must not take the tenant's data offline while
  // it runs. One object per tenant-owned table, plus the catalog, plus the manifest.
  public abstract exportTenant(organizationId: OrganizationId, day: Date): Promise<TenantExport>;

  // The tombstone the recovery window is measured from. Stamped when the tenant is
  // deleted, because `archived_at` dates the month rather than the deletion.
  public abstract markTenantDeleted(organizationId: OrganizationId, at: Date): Promise<number>;

  // Every tenant deleted before `before`, read off the tombstone. The delay is
  // deliberate: a deletion is recoverable for exactly that long.
  public abstract sweepDeleted(before: Date): Promise<DeletedTenantSweep>;
}
