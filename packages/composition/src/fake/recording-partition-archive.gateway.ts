import {
  type ArchivedObject,
  type ArchivedPartition,
  type DeletedTenantSweep,
  type ExportedObject,
  type OrganizationId,
  PartitionArchiveGateway,
  type PartitionedTableName,
  type TenantExport,
} from "../import.js";

export interface ArchiveRequest {
  readonly table: PartitionedTableName;
  readonly period: Date;
  // Null is "every tenant", which is the shape the prune pass uses unless an override
  // makes it walk them one at a time.
  readonly organizationId?: OrganizationId | null;
}

// Records what it was asked for. The real gateway detaches and drops a partition, so a
// test that used it would destroy the fixture it was asserting on.
export class RecordingPartitionArchiveGateway extends PartitionArchiveGateway {
  private readonly requests: ArchiveRequest[] = [];
  private readonly sweeps: OrganizationId[] = [];
  private readonly deletedSweeps: Date[] = [];
  private readonly tombstones: { organizationId: OrganizationId; at: Date }[] = [];
  private readonly exports: { organizationId: OrganizationId; day: string }[] = [];
  private exported: readonly ExportedObject[] = [];
  private deleted: DeletedTenantSweep = { organizations: 0, objects: 0 };

  // What every `archive` call reports it wrote. Empty by default, so a spec that is not
  // about the objects does not have to invent any.
  public constructor(private readonly objects: readonly ArchivedObject[] = []) {
    super();
  }

  public override archive(
    table: PartitionedTableName,
    period: Date,
    organizationId?: OrganizationId,
  ): Promise<ArchivedPartition> {
    this.requests.push({ table, period, organizationId: organizationId ?? null });

    // `dropped` is derived from the objects rather than given: the real gateway drops
    // exactly what it archived, and a fake that could disagree would hide a bug there.
    return Promise.resolve({
      table,
      period: period.toISOString().slice(0, 10),
      objects: this.objects,
      dropped: this.objects.map((object) => `${table}_${object.organizationId}`),
    });
  }

  public override sweep(organizationId: OrganizationId): Promise<number> {
    this.sweeps.push(organizationId);
    return Promise.resolve(0);
  }

  // Staged, because the count is what the consumer logs: a fake returning zero would
  // let a line claiming it swept nothing pass whatever the sweep did.
  public stageDeleted(sweep: DeletedTenantSweep): void {
    this.deleted = sweep;
  }

  // Recorded rather than counted: the delete use-case's spec asserts the tombstone was
  // stamped at all, which is the half that makes the sweep reachable.
  public override markTenantDeleted(organizationId: OrganizationId, at: Date): Promise<number> {
    this.tombstones.push({ organizationId, at });
    return Promise.resolve(1);
  }

  public tenantsMarkedDeleted(): readonly { organizationId: OrganizationId; at: Date }[] {
    return this.tombstones;
  }

  public override sweepDeleted(before: Date): Promise<DeletedTenantSweep> {
    this.deletedSweeps.push(before);
    return Promise.resolve(this.deleted);
  }

  public deletedSwept(): readonly Date[] {
    return this.deletedSweeps;
  }

  // Staged, because the objects are what the consumer logs and what the screen lists.
  public stageExport(objects: readonly ExportedObject[]): void {
    this.exported = objects;
  }

  public override exportTenant(organizationId: OrganizationId, day: Date): Promise<TenantExport> {
    const stamp = day.toISOString().slice(0, 10);
    this.exports.push({ organizationId, day: stamp });

    return Promise.resolve({
      organizationId,
      day: stamp,
      objects: this.exported,
      manifestKey: `export/${organizationId}/${stamp}/manifest.json`,
    });
  }

  public tenantExports(): readonly { organizationId: OrganizationId; day: string }[] {
    return this.exports;
  }

  public archived(): readonly ArchiveRequest[] {
    return this.requests;
  }

  public swept(): readonly OrganizationId[] {
    return this.sweeps;
  }
}
