import { Identifiers } from "@loadbearing/contracts";
import { describe, expect, it } from "vitest";
import type { PlatformReader } from "../../src/platform/platform.reader.js";
import { PurgeOrganizationUseCase } from "../../src/platform/purge-organization.use-case.js";
import type { TenantRecord, TenantRepository } from "../../src/platform/tenant.repository.js";
import type { TenantRetentionPolicyRepository } from "../../src/platform/tenant-retention-policy.repository.js";
import type {
  ActivityLogger,
  AnalyticsProjector,
  ArchivedPartition,
  CapabilityInvalidator,
  MaintenanceGateway,
  OutboxGateway,
  PartitionArchiveGateway,
  PartitionEstimate,
  ShardResolver,
  UnitOfWork,
} from "../../src/port/index.js";
import type { Principal } from "../../src/primitive/principal.js";

const PLATFORM = Identifiers.organizationId.parse("018f8c00-0000-7000-8000-000000000001");
const TENANT = Identifiers.organizationId.parse("018f8c00-0000-7000-8000-000000000010");
const ACTOR = Identifiers.userId.parse("018f8c00-0000-7000-8000-000000000011");
const NOW = new Date("2026-08-15T00:00:00.000Z");

const TENANT_ROW: TenantRecord = { id: TENANT, slug: "acme", name: "Acme", isPlatform: false };

class FakeTenants implements TenantRepository {
  public readonly deleted: string[] = [];

  public constructor(private readonly row: TenantRecord | null = TENANT_ROW) {}

  public findBy(): Promise<TenantRecord | null> {
    return Promise.resolve(this.row);
  }

  public delete(organizationId: string): Promise<void> {
    this.deleted.push(organizationId);
    return Promise.resolve();
  }
}

// `deleteFor` had no caller anywhere, and the schema has no foreign key on that table
// precisely because the delete path is what sweeps it.
class FakeTenantRetention {
  public readonly swept: string[] = [];

  public deleteFor(organizationId: string): Promise<void> {
    this.swept.push(organizationId);
    return Promise.resolve();
  }
}

class FakeArchive implements Partial<PartitionArchiveGateway> {
  public readonly calls: { table: string; period: string; organizationId?: string }[] = [];
  public readonly tombstones: { organizationId: string; at: string }[] = [];

  public markTenantDeleted(organizationId: string, at: Date): Promise<number> {
    this.tombstones.push({ organizationId, at: at.toISOString() });
    return Promise.resolve(1);
  }

  public archive(table: string, period: Date, organizationId?: string): Promise<ArchivedPartition> {
    this.calls.push({ table, period: period.toISOString().slice(0, 10), organizationId });
    return Promise.resolve({
      table,
      period: period.toISOString().slice(0, 10),
      objects: [
        { organizationId, key: "k", rowCount: 1, bytes: 1, checksum: "c", actionCounts: {} },
      ],
      dropped: [],
    } as unknown as ArchivedPartition);
  }
}

class FakeMaintenance implements Partial<MaintenanceGateway> {
  public readonly cutoffs: { table: string; cutoff: string; organizationId?: string | null }[] = [];
  public readonly drops: string[] = [];

  public constructor(private readonly periods: readonly Date[] = []) {}

  public partitionsBefore(
    table: string,
    cutoff: Date,
    organizationId?: string | null,
  ): Promise<readonly PartitionEstimate[]> {
    this.cutoffs.push({ table, cutoff: cutoff.toISOString(), organizationId });
    return Promise.resolve(
      this.periods.map((period) => ({ name: `${table}_x`, period, estimatedRows: 0, bytes: 0 })),
    );
  }

  public dropTenantPartitions(organizationId: string): Promise<readonly string[]> {
    this.drops.push(organizationId);
    return Promise.resolve(["a", "b", "c"]);
  }
}

class FakeActivity implements ActivityLogger {
  public readonly rows: { organizationId: string; action: string }[] = [];

  public record(actor: Principal, action: string): Promise<void> {
    this.rows.push({ organizationId: actor.organizationId, action });
    return Promise.resolve();
  }
}

class FakeInvalidator implements Partial<CapabilityInvalidator> {
  public readonly flushed: string[] = [];

  public invalidateOrganization(organizationId: string): Promise<void> {
    this.flushed.push(organizationId);
    return Promise.resolve();
  }
}

class FakeProjector implements Partial<AnalyticsProjector> {
  public readonly forgotten: string[] = [];

  public deleteTenant(organizationId: string): Promise<void> {
    this.forgotten.push(organizationId);
    return Promise.resolve();
  }
}

// Records the keys it was asked to forget. The placement cache has a deliberately long
// TTL, so "was it invalidated" is the whole behaviour and a double that shrugged would
// ──
// let a deleted tenant keep resolving to a node for minutes.
class FakeShards {
  public readonly invalidated: string[] = [];

  public resolve(): Promise<number> {
    return Promise.resolve(0);
  }

  public invalidate(key: string): Promise<void> {
    this.invalidated.push(key);
    return Promise.resolve();
  }
}
// The replacement for the foreign key `24.1` dropped. `outbox_event` has no tenant
// level, so the partition drop never reaches its rows and this is the only reaper.
class FakeOutbox implements Partial<OutboxGateway> {
  public readonly swept: string[] = [];

  public deleteFor(organizationId: string): Promise<number> {
    this.swept.push(organizationId);
    return Promise.resolve(7);
  }
}

interface Parts {
  readonly tenants: FakeTenants;
  readonly archive: FakeArchive;
  readonly maintenance: FakeMaintenance;
  readonly outbox: FakeOutbox;
  readonly activity: FakeActivity;
  readonly capabilities: FakeInvalidator;
  readonly projector: FakeProjector | null;
  readonly tenantRetention: FakeTenantRetention;
  readonly shards: FakeShards;
}

const build = (overrides: Partial<Parts> = {}) => {
  const parts: Parts = {
    tenants: new FakeTenants(),
    archive: new FakeArchive(),
    maintenance: new FakeMaintenance(),
    outbox: new FakeOutbox(),
    activity: new FakeActivity(),
    capabilities: new FakeInvalidator(),
    projector: new FakeProjector(),
    tenantRetention: new FakeTenantRetention(),
    shards: new FakeShards(),
    ...overrides,
  };

  const unitOfWork = { run: (work: () => Promise<unknown>) => work() } as unknown as UnitOfWork;
  const platform = {
    organizationId: () => Promise.resolve(PLATFORM),
    organization: () => Promise.resolve({ id: PLATFORM, slug: "platform", name: "Platform" }),
  } as unknown as PlatformReader;

  return {
    parts,
    useCase: new PurgeOrganizationUseCase(
      parts.tenants,
      parts.archive as unknown as PartitionArchiveGateway,
      parts.maintenance as unknown as MaintenanceGateway,
      parts.outbox as unknown as OutboxGateway,
      parts.capabilities as unknown as CapabilityInvalidator,
      platform,
      parts.activity,
      unitOfWork,
      { now: () => NOW },
      parts.projector as unknown as AnalyticsProjector | null,
      parts.tenantRetention as unknown as TenantRetentionPolicyRepository,
      parts.shards as unknown as ShardResolver,
    ),
  };
};

const input = { organizationId: TENANT, actorId: ACTOR };

describe("PurgeOrganizationUseCase", () => {
  // The cutoff is the first of *next* month, not now: the partitions are about to be
  // dropped, so a month left unarchived is rows nothing can hand back.
  it("archives every month that exists, including the current one", async () => {
    const maintenance = new FakeMaintenance([new Date(Date.UTC(2026, 7, 1))]);
    const { parts, useCase } = build({ maintenance });

    const result = await useCase.execute(input);

    expect(maintenance.cutoffs.every((call) => call.cutoff === "2026-09-01T00:00:00.000Z")).toBe(
      true,
    );
    expect(maintenance.cutoffs.map((call) => call.table)).toEqual([
      "activity_log",
      "notifications",
      "messages",
      "doc_revision",
    ]);
    expect(parts.archive.calls.every((call) => call.organizationId === TENANT)).toBe(true);
    expect(result.archived).toBe(4);
  });

  // The order is the behaviour: archive, then drop, then delete the row. A drop before
  // the archive is the month gone with nothing to hand back.
  it("drops the partitions before deleting the row", async () => {
    const { parts, useCase } = build();
    const result = await useCase.execute(input);

    expect(parts.maintenance.drops).toEqual([TENANT]);
    expect(parts.tenants.deleted).toEqual([TENANT]);
    expect(result.partitions).toBe(3);
  });

  // `24.1` dropped the cascade that did this, and a partition drop never reaches
  // `outbox_event` -- it has no tenant level. Without this the rows are orphaned.
  it("sweeps the tenant's outbox rows, which no partition drop reaches", async () => {
    const { parts, useCase } = build();
    const result = await useCase.execute(input);

    expect(parts.outbox.swept).toEqual([TENANT]);
    expect(result.outboxRows).toBe(7);
  });

  // The sweep reads the tombstone and nothing else, so a delete that skipped this
  // leaves the objects in the bucket with nothing to end their window.
  it("stamps the tombstone the recovery window is measured from", async () => {
    const { parts, useCase } = build();
    await useCase.execute(input);

    expect(parts.archive.tombstones).toHaveLength(1);
    expect(parts.archive.tombstones[0]?.organizationId).toBe(TENANT);
  });

  // Rebased onto the tier, which is the only reason the row survives the delete: under
  // the tenant it would be a partition that no longer exists.
  it("records the audit row under the platform organization", async () => {
    const { parts, useCase } = build();
    await useCase.execute(input);

    expect(parts.activity.rows).toEqual([{ organizationId: PLATFORM, action: "tenant.deleted" }]);
  });

  it("flushes the capability cache and forgets the tenant in the derived store", async () => {
    const { parts, useCase } = build();
    await useCase.execute(input);

    expect(parts.capabilities.flushed).toEqual([TENANT]);
    expect(parts.projector?.forgotten).toEqual([TENANT]);
  });

  // Skipped rather than failed: with no analytics store there is no derived copy to
  // forget, and a deployment running without one must still be able to delete a tenant.
  it("completes with no analytics store configured", async () => {
    const { useCase } = build({ projector: null });
    await expect(useCase.execute(input)).resolves.toEqual({
      archived: 0,
      partitions: 3,
      outboxRows: 7,
    });
  });

  // No foreign key on that table, so nothing cascades. `deleteFor` had no caller at all,
  // and an override outlived its tenant forever.
  it("sweeps the tenant's retention overrides", async () => {
    const { parts, useCase } = build();
    await useCase.execute(input);

    expect(parts.tenantRetention.swept).toEqual([TENANT]);
  });

  // A job is retried, and every step below is idempotent on its own. Reporting the
  // second pass as if it had archived nothing would still be a lie about this run.
  it("is a no-op when the tenant is already gone", async () => {
    const { parts, useCase } = build({ tenants: new FakeTenants(null) });

    await expect(useCase.execute(input)).resolves.toEqual({
      archived: 0,
      partitions: 0,
      outboxRows: 0,
    });
    expect(parts.maintenance.drops).toEqual([]);
    expect(parts.outbox.swept).toEqual([]);
    expect(parts.archive.tombstones).toEqual([]);
  });
});

// `19.20`: the placement cache outlived the tenant. Its TTL is deliberately long --
// the answer changes only on a move -- so nothing else would have cleared it.
describe("PurgeOrganizationUseCase and the placement cache", () => {
  it("forgets the deleted tenant's placement", async () => {
    const { parts, useCase } = build();

    await useCase.execute(input);

    expect(parts.shards.invalidated).toEqual([TENANT]);
  });

  // After the commit, like the capability flush beside it: a cache cleared first is
  // refilled from rows the transaction has not removed yet.
  it("does not forget a tenant that was already gone", async () => {
    const { parts, useCase } = build({ tenants: new FakeTenants(null) });

    await useCase.execute(input);

    expect(parts.shards.invalidated).toEqual([]);
  });
});
