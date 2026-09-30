import {
  MaintenanceGateway,
  type OrganizationId,
  type PartitionEstimate,
  type PartitionedTableName,
  type SweepOutcome,
  type TenantRunway,
} from "../import.js";

export interface EnsuredPartitions {
  readonly table: PartitionedTableName;
  readonly organizationId: OrganizationId | null;
  readonly from: Date;
  readonly months: number;
}

export interface RunwayCheck {
  readonly table: PartitionedTableName;
  readonly organizationId: OrganizationId | null;
  readonly from: Date;
}

// Records rather than counts, for the same reason `RecordingActivityLogger` does: the
// assertion worth writing is "the sweep ran with this clock", not "the sweep ran".
export class RecordingMaintenanceGateway extends MaintenanceGateway {
  private readonly sweeps: Date[] = [];
  private readonly partitionRuns: EnsuredPartitions[] = [];
  private readonly runwayChecks: RunwayCheck[] = [];
  private readonly tenantRuns: OrganizationId[] = [];
  private readonly tenantDrops: OrganizationId[] = [];
  // Seeded rather than recorded: a spec about the nightly count wants to say what the
  // node holds, not to assert that the job asked.
  public orphans: OrganizationId[] = [];
  // How many spares the pool already holds; a top-up makes the difference and records it.
  public spares = 0;
  public readonly topUps: number[] = [];

  public constructor(
    private readonly outcome: SweepOutcome = { sessions: 0, verifications: 0, invitations: 0 },
    // What `monthlyPartitionsAfter` answers. The default is healthy, so a spec that does
    // not care about the runway does not have to say so.
    private readonly monthsAhead = 2,
    // What `partitionsBefore` returns. Empty, so the preview reads "nothing to archive"
    // unless a spec is about the preview.
    private readonly estimates: readonly PartitionEstimate[] = [],
  ) {
    super();
  }

  public override sweepExpired(now: Date): Promise<SweepOutcome> {
    this.sweeps.push(now);
    return Promise.resolve(this.outcome);
  }

  public override ensureTenantPartitions(
    organizationId: OrganizationId,
  ): Promise<readonly string[]> {
    this.tenantRuns.push(organizationId);
    return Promise.resolve([]);
  }

  public override topUpSpareTenants(target: number): Promise<number> {
    const made = Math.max(0, target - this.spares);
    this.spares += made;
    this.topUps.push(made);
    return Promise.resolve(made);
  }

  public override dropTenantPartitions(organizationId: OrganizationId): Promise<readonly string[]> {
    this.tenantDrops.push(organizationId);
    return Promise.resolve([]);
  }

  public override orphanedTenants(): Promise<readonly OrganizationId[]> {
    return Promise.resolve(this.orphans);
  }

  public override ensureMonthlyPartitions(
    table: PartitionedTableName,
    organizationId: OrganizationId | null,
    from: Date,
    months: number,
  ): Promise<readonly string[]> {
    this.partitionRuns.push({ table, organizationId, from, months });
    return Promise.resolve([]);
  }

  // Recorded as the two calls it replaces, so a spec about the runway reads the same
  // whichever path the consumer took.
  public override ensureMonthlyPartitionsFor(
    table: PartitionedTableName,
    organizationIds: readonly OrganizationId[],
    from: Date,
    months: number,
  ): Promise<readonly TenantRunway[]> {
    return Promise.resolve(
      organizationIds.map((organizationId) => {
        this.runwayChecks.push({ table, organizationId, from });
        this.partitionRuns.push({ table, organizationId, from, months });
        return { organizationId, monthsAhead: this.monthsAhead, created: [] };
      }),
    );
  }

  public override monthlyPartitionsAfter(
    table: PartitionedTableName,
    organizationId: OrganizationId | null,
    from: Date,
  ): Promise<number> {
    this.runwayChecks.push({ table, organizationId, from });
    return Promise.resolve(this.monthsAhead);
  }

  public override partitionsBefore(): Promise<readonly PartitionEstimate[]> {
    return Promise.resolve(this.estimates);
  }

  public swept(): readonly Date[] {
    return this.sweeps;
  }

  public partitionsEnsured(): readonly EnsuredPartitions[] {
    return this.partitionRuns;
  }

  public runwayChecked(): readonly RunwayCheck[] {
    return this.runwayChecks;
  }

  public tenantsEnsured(): readonly OrganizationId[] {
    return this.tenantRuns;
  }

  public tenantsDropped(): readonly OrganizationId[] {
    return this.tenantDrops;
  }
}
