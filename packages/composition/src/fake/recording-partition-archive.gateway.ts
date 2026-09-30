import {
  type ArchivedObject,
  type ArchivedPartition,
  type DeletedTenantSweep,
  type ExportedObject,
  type OrganizationId,
  type PartitionArchiveEntry,
  PartitionArchiveGateway,
  type PartitionedTableName,
  type ProjectionGap,
  type RestoredMonth,
  type TenantExport,
} from "../import.js";

export interface ArchiveRequest {
  readonly table: PartitionedTableName;
  readonly period: Date;
  // Null is "every tenant", which is the shape the prune pass uses unless an override
  // makes it walk them one at a time.
  readonly organizationId?: OrganizationId | null;
}

export interface RestoreRequest extends ArchiveRequest {
  readonly organizationId: OrganizationId;
}

// Records what it was asked for. The real gateway detaches and drops a partition, so a
// test that used it would destroy the fixture it was asserting on.
export class RecordingPartitionArchiveGateway extends PartitionArchiveGateway {
  private readonly requests: ArchiveRequest[] = [];
  private readonly restores: RestoreRequest[] = [];
  private readonly stamps: RestoreRequest[] = [];
  private entries: readonly PartitionArchiveEntry[] = [];
  private readonly forgotten: ArchiveRequest[] = [];
  private readonly sweeps: OrganizationId[] = [];
  private readonly deletedSweeps: Date[] = [];
  private readonly tombstones: { organizationId: OrganizationId; at: Date }[] = [];
  private holes: readonly ProjectionGap[] = [];
  private readonly exports: { organizationId: OrganizationId; day: string }[] = [];
  private exported: readonly ExportedObject[] = [];
  private deleted: DeletedTenantSweep = { organizations: 0, objects: 0 };

  // What every `archive` call reports it wrote. Empty by default, so a spec that is not
  // about the objects does not have to invent any.
  public constructor(private readonly objects: readonly ArchivedObject[] = []) {
    super();
  }

  // Nothing is ever left detached in memory, so there is nothing to put back.
  public override recover(): Promise<readonly string[]> {
    return Promise.resolve([]);
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

  public override restore(
    table: PartitionedTableName,
    period: Date,
    organizationId: OrganizationId,
  ): Promise<RestoredMonth> {
    this.restores.push({ table, period, organizationId });

    return Promise.resolve({
      table,
      period: period.toISOString().slice(0, 10),
      organizationId,
      scratchTable: `${table}_restore`,
      rowCount: 0,
    });
  }

  public override markProjected(
    table: PartitionedTableName,
    period: Date,
    organizationId: OrganizationId,
  ): Promise<void> {
    this.stamps.push({ table, period, organizationId });
    return Promise.resolve();
  }

  // Staged rather than derived: a spec that wants a restore to find something says so,
  // and one that does not gets the empty answer a month nobody archived would give.
  public stage(entries: readonly PartitionArchiveEntry[]): void {
    this.entries = entries;
  }

  public override entriesFor(
    table: PartitionedTableName,
    period: string,
    organizationId?: OrganizationId,
  ): Promise<readonly PartitionArchiveEntry[]> {
    return Promise.resolve(
      this.entries.filter(
        (entry) =>
          entry.tableName === table &&
          entry.period === period &&
          (!organizationId || entry.organizationId === organizationId),
      ),
    );
  }

  public override forget(table: PartitionedTableName, before: Date): Promise<number> {
    this.forgotten.push({ table, period: before });
    return Promise.resolve(0);
  }

  public forgets(): readonly ArchiveRequest[] {
    return this.forgotten;
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

  // Staged, because a gap is what the screen lists and what a re-project acts on: a
  // fake deriving it from the staged entries would let a spec pass on the wrong month.
  public stageGaps(gaps: readonly ProjectionGap[]): void {
    this.holes = gaps;
  }

  // Off the same staged entries `entriesFor` reads, so a spec cannot stage a month
  // for one read and have the other disagree about it.
  public override monthsOf(
    table: PartitionedTableName,
    organizationId: OrganizationId,
  ): Promise<readonly PartitionArchiveEntry[]> {
    return Promise.resolve(
      this.entries
        .filter((entry) => entry.tableName === table && entry.organizationId === organizationId)
        .toSorted((left, right) => left.period.localeCompare(right.period)),
    );
  }

  public override gaps(table: PartitionedTableName): Promise<readonly ProjectionGap[]> {
    return Promise.resolve(this.holes.filter((gap) => gap.tableName === table));
  }

  public archived(): readonly ArchiveRequest[] {
    return this.requests;
  }

  public restored(): readonly RestoreRequest[] {
    return this.restores;
  }

  public projected(): readonly RestoreRequest[] {
    return this.stamps;
  }

  public swept(): readonly OrganizationId[] {
    return this.sweeps;
  }
}
