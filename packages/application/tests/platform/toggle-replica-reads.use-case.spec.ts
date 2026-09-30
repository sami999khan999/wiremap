import { Identifiers } from "@loadbearing/contracts";
import { ConflictError, ForbiddenError } from "@loadbearing/errors";
import { CapabilitySet, type PermissionKey } from "@loadbearing/permissions";
import { describe, expect, it } from "vitest";
import type { PlatformReader } from "../../src/platform/platform.reader.js";
import type {
  PlatformHealth,
  PlatformHealthReader,
  ReplicaHealthReport,
} from "../../src/platform/platform-health.reader.js";
import type {
  PlatformPolicyRecord,
  PlatformPolicyRepository,
} from "../../src/platform/platform-policy.repository.js";
import { ToggleReplicaReadsUseCase } from "../../src/platform/toggle-replica-reads.use-case.js";
import type { ActivityLogger, UnitOfWork } from "../../src/port/index.js";
import { Authorizer } from "../../src/primitive/authorizer.js";
import { Principal } from "../../src/primitive/principal.js";

const PLATFORM = Identifiers.organizationId.parse("018f8c00-0000-7000-8000-000000000001");
const TENANT = Identifiers.organizationId.parse("018f8c00-0000-7000-8000-000000000010");
const ACTOR = Identifiers.userId.parse("018f8c00-0000-7000-8000-000000000011");

class FakePolicy implements PlatformPolicyRepository {
  public record: PlatformPolicyRecord = {
    projectionEnabled: true,
    replicaReadsEnabled: false,
    moveGraceDays: 3,
  };

  public get(): Promise<PlatformPolicyRecord> {
    return Promise.resolve(this.record);
  }

  public save(record: PlatformPolicyRecord): Promise<void> {
    this.record = record;
    return Promise.resolve();
  }
}

const health = (standby: ReplicaHealthReport | null) =>
  ({
    report: () => Promise.resolve({} as PlatformHealth),
    replica: () => Promise.resolve(standby),
  }) as PlatformHealthReader;

function harness(standby: ReplicaHealthReport | null = { healthy: true, lagSeconds: 0 }) {
  const policy = new FakePolicy();
  const recorded: { organizationId: string; action: string }[] = [];
  const activity: ActivityLogger = {
    record: (actor, action) => {
      recorded.push({ organizationId: actor.organizationId, action });
      return Promise.resolve();
    },
  };
  const unitOfWork = { run: <T>(work: () => Promise<T>) => work() } as UnitOfWork;
  const platform = { organizationId: () => Promise.resolve(PLATFORM) } as PlatformReader;

  const useCase = new ToggleReplicaReadsUseCase(
    new Authorizer(),
    policy,
    health(standby),
    platform,
    activity,
    unitOfWork,
  );
  return { useCase, policy, recorded };
}

const actor = (platform: readonly PermissionKey[]) =>
  new Principal(
    TENANT,
    ACTOR,
    CapabilitySet.from({
      wildcard: false,
      org: { grants: [], denies: [] },
      goals: {},
      platform: { grants: platform, denies: [] },
    }),
  );

describe("ToggleReplicaReadsUseCase", () => {
  it("saves the switch, keeps the rest of the row, and audits on the platform tenant", async () => {
    const { useCase, policy, recorded } = harness();

    await useCase.execute(actor(["platform.replica.manage"]), { enabled: true });

    expect(policy.record).toEqual({
      projectionEnabled: true,
      replicaReadsEnabled: true,
      moveGraceDays: 3,
    });
    expect(recorded).toEqual([{ organizationId: PLATFORM, action: "platform.replica.enabled" }]);

    await useCase.execute(actor(["platform.replica.manage"]), { enabled: false });
    expect(policy.record.replicaReadsEnabled).toBe(false);
    expect(recorded[1]?.action).toBe("platform.replica.disabled");
  });

  it("refuses a deployment that runs no standby, and saves nothing", async () => {
    const { useCase, policy } = harness(null);

    await expect(
      useCase.execute(actor(["platform.replica.manage"]), { enabled: true }),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(policy.record.replicaReadsEnabled).toBe(false);
  });

  it("refuses a reader of the status page who may not change it", async () => {
    const { useCase } = harness();

    await expect(
      useCase.execute(actor(["platform.status.read"]), { enabled: true }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});
