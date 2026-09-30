import { DocImageKey, type DocImageSweep } from "../doc/index.js";
import { CapabilitySet, type OrganizationId, type UserId } from "../import.js";
import type {
  ActivityLogger,
  AnalyticsProjector,
  CapabilityInvalidator,
  MaintenanceGateway,
  OutboxGateway,
  PartitionArchiveGateway,
  ShardResolver,
  UnitOfWork,
} from "../port/index.js";
import { PartitionedTable, Principal, Shard } from "../primitive/index.js";
import type { PlatformReader } from "./platform.reader.js";
import type { TenantRepository } from "./tenant.repository.js";
import type { TenantRetentionPolicyRepository } from "./tenant-retention-policy.repository.js";

export interface PurgeOrganizationInput {
  readonly organizationId: OrganizationId;
  // Who asked, carried through the queue so the audit row still names a person. The
  // job's own principal is the system's and would name nobody.
  readonly actorId: UserId;
}

export interface PurgedOrganization {
  readonly archived: number;
  readonly partitions: number;
  readonly outboxRows: number;
}

// The job half of a tenant delete, run **placed on the tenant's node**. It asserts no
// permission: `DeleteOrganizationUseCase` did, and a job has no actor to assert against.
export class PurgeOrganizationUseCase {
  public constructor(
    private readonly tenants: TenantRepository,
    private readonly archive: PartitionArchiveGateway,
    private readonly maintenance: MaintenanceGateway,
    private readonly outbox: OutboxGateway,
    private readonly capabilities: CapabilityInvalidator,
    private readonly platform: PlatformReader,
    private readonly activity: ActivityLogger,
    private readonly unitOfWork: UnitOfWork,
    private readonly clock: { now(): Date },
    // Absent on a deployment running no analytics store. Skipped rather than failed:
    // there is no derived copy to forget.
    private readonly projector: AnalyticsProjector | null,
    // The overrides. No foreign key on that table — the schema says so, and says
    // the delete path sweeps it — and `deleteFor` had no caller anywhere.
    private readonly tenantRetention: TenantRetentionPolicyRepository,
    // The placement cache. Its TTL is deliberately long, so without this a deleted
    // tenant keeps resolving to a node for up to five minutes after its rows are gone.
    private readonly shards: ShardResolver,
    // The tenant's doc images. Their prefix is the only index they have, so no partition
    // drop reaches them and nothing else would ever delete them.
    private readonly images: DocImageSweep | null = null,
  ) {}

  public async execute(input: PurgeOrganizationInput): Promise<PurgedOrganization> {
    // A retry finds the tenant gone and stops. Every step below is idempotent on its
    // own, but reporting a second delete as if it archived nothing would be a lie.
    const tenant = await this.tenants.findBy(input.organizationId);
    if (!tenant) return { archived: 0, partitions: 0, outboxRows: 0 };

    const archived = await this.archiveEverything(input.organizationId);

    // Outside the transaction, and before it: dropping a partition is a catalog edit,
    // and a transaction holding seven of them blocks every other DDL in the system.
    const partitions = await this.maintenance.dropTenantPartitions(input.organizationId);

    // What the foreign key dropped in `24.1` used to do. `outbox_event` has no tenant
    // level, so the partition drop above never reaches its rows.
    const outboxRows = await this.outbox.deleteFor(input.organizationId);
    const images = (await this.images?.sweep(DocImageKey.tenantPrefix(input.organizationId))) ?? 0;

    // `system`, and with no capabilities: this actor authorizes nothing, it only names
    // who asked. The permission was asserted when the job was queued.
    const auditor = Principal.system(
      await this.platform.organizationId(),
      input.actorId,
      CapabilitySet.empty(),
    );

    // Before the row goes. The sweep reads this and nothing else, so a delete that
    // skipped it would leave the objects in the bucket with nothing to end their window.
    await this.archive.markTenantDeleted(input.organizationId, this.clock.now());

    await this.unitOfWork.run(async () => {
      await this.tenantRetention.deleteFor(input.organizationId);
      await this.tenants.delete(input.organizationId);

      // Rebased onto the tier, which is the only reason this row survives the delete
      // at all: under the tenant it would be a partition that no longer exists.
      await this.activity.record(auditor, "tenant.deleted", {
        organizationId: input.organizationId,
        slug: tenant.slug,
        name: tenant.name,
        archivedObjects: archived,
        partitions: partitions.length,
        outboxRows,
        images,
      });
    });

    // After the commit. A cache flushed before it would be refilled from rows the
    // transaction had not removed yet, which is the stale entry it was meant to stop.
    await this.capabilities.invalidateOrganization(input.organizationId);
    // The `shard_assignments` row itself is left, deliberately: every reader inner-joins
    // `organizations`, so it is invisible rather than stale. The *cache* is the problem —
    // ──
    // it answers from Redis without the join, for as long as its TTL holds.
    await this.shards.invalidate(Shard.keyOf(input.organizationId));
    await this.projector?.deleteTenant(input.organizationId);

    return { archived, partitions: partitions.length, outboxRows };
  }

  // Every month that exists, not every month past a retention cutoff: the partitions
  // are about to be dropped, so an unarchived one is rows nothing can hand back.
  private async archiveEverything(organizationId: OrganizationId): Promise<number> {
    const now = this.clock.now();
    const cutoff = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
    let objects = 0;

    for (const table of PartitionedTable.MONTH_PARTITIONED) {
      if (table.tenantKey === null) continue;

      for (const period of await this.periodsBefore(table.name, cutoff, organizationId)) {
        const result = await this.archive.archive(table.name, period, organizationId);
        objects += result.objects.length;
      }
    }

    return objects;
  }

  private async periodsBefore(
    table: (typeof PartitionedTable.MONTH_PARTITIONED)[number]["name"],
    cutoff: Date,
    organizationId: OrganizationId,
  ): Promise<readonly Date[]> {
    const estimates = await this.maintenance.partitionsBefore(table, cutoff, organizationId);
    const periods = new Map<number, Date>();

    for (const estimate of estimates) periods.set(estimate.period.getTime(), estimate.period);

    return [...periods.values()].sort((left, right) => left.getTime() - right.getTime());
  }
}
