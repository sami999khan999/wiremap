import { Identifiers } from "@loadbearing/contracts";
import { ConflictError, ForbiddenError, NotFoundError } from "@loadbearing/errors";
import { CapabilitySet, type PermissionKey } from "@loadbearing/permissions";
import { describe, expect, it } from "vitest";
import { MoveTenantUseCase } from "../../src/platform/move-tenant.use-case.js";
import type { PlatformReader } from "../../src/platform/platform.reader.js";
import type { TenantRecord, TenantRepository } from "../../src/platform/tenant.repository.js";
import type { JobOptions, QueuePublisher, ShardAssignment } from "../../src/port/index.js";
import { Authorizer } from "../../src/primitive/authorizer.js";
import { Principal } from "../../src/primitive/principal.js";
import { QueueName } from "../../src/primitive/queue-name.js";
import { Shard } from "../../src/primitive/shard.js";
import { FakeActivity, FakeAssignments, unmoved } from "./tenant-move-doubles.js";

const PLATFORM = Identifiers.organizationId.parse("018f8c00-0000-7000-8000-000000000001");
const TENANT = Identifiers.organizationId.parse("018f8c00-0000-7000-8000-000000000010");
const ACTOR = Identifiers.userId.parse("018f8c00-0000-7000-8000-000000000011");
const KEY = Shard.keyOf(TENANT);

const TENANT_ROW: TenantRecord = { id: TENANT, slug: "acme", name: "Acme", isPlatform: false };

class FakeTenants implements TenantRepository {
  public constructor(private readonly row: TenantRecord | null = TENANT_ROW) {}

  public findBy(): Promise<TenantRecord | null> {
    return Promise.resolve(this.row);
  }

  public delete(): Promise<void> {
    return Promise.reject(new Error("a move never deletes a tenant"));
  }
}

class FakeQueue implements Partial<QueuePublisher> {
  public readonly published: { queue: string; payload: unknown; options?: JobOptions }[] = [];

  public publish(queue: string, payload: unknown, options?: JobOptions): Promise<void> {
    this.published.push({ queue, payload, options });
    return Promise.resolve();
  }
}

const actor = (...platform: readonly PermissionKey[]): Principal =>
  new Principal(
    PLATFORM,
    ACTOR,
    CapabilitySet.from({
      wildcard: false,
      org: { grants: [], denies: [] },
      goals: {},
      platform: { grants: platform, denies: [] },
    }),
  );

const allowed = () => actor("platform.shards.manage");

const build = (
  assignment: ShardAssignment | null = unmoved(KEY, 0),
  tenants: FakeTenants = new FakeTenants(),
) => {
  const queue = new FakeQueue();
  const activity = new FakeActivity();
  const platform = {
    organizationId: () => Promise.resolve(PLATFORM),
  } as unknown as PlatformReader;

  return {
    queue,
    activity,
    useCase: new MoveTenantUseCase(
      new Authorizer(),
      tenants,
      new FakeAssignments(assignment ? [assignment] : []),
      queue as unknown as QueuePublisher,
      platform,
      activity,
      3,
    ),
  };
};

const input = { organizationId: TENANT, toNode: 1 };

// The request half. Every guard runs here, so a mistake is a sentence on the screen
// rather than a job that starts, freezes a tenant, and then finds out.
describe("MoveTenantUseCase", () => {
  it("refuses an actor without the platform key", async () => {
    await expect(build().useCase.execute(actor(), input)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it.each([-1, 3, 1.5])("refuses node %s, which this deployment does not have", async (toNode) => {
    await expect(
      build().useCase.execute(allowed(), { organizationId: TENANT, toNode }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("is NOT_FOUND for a tenant that is gone", async () => {
    const { useCase } = build(unmoved(KEY, 0), new FakeTenants(null));
    await expect(useCase.execute(allowed(), input)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("is NOT_FOUND for a tenant the directory never placed", async () => {
    await expect(build(null).useCase.execute(allowed(), input)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it.each([
    ["a move is in flight", { ...unmoved(KEY, 0), movingTo: 2 }],
    ["the tenant is already there", unmoved(KEY, 1)],
    ["an earlier source copy is on a third node", { ...unmoved(KEY, 2), movedFrom: 0 }],
  ])("refuses when %s, and queues nothing", async (_reason, assignment) => {
    const { queue, useCase } = build(assignment);

    await expect(useCase.execute(allowed(), input)).rejects.toBeInstanceOf(ConflictError);
    expect(queue.published).toEqual([]);
  });

  // The way back is a move like any other, onto the node the source copy is still on.
  it("allows a move back to the node the source copy is on", async () => {
    const { queue, useCase } = build({ ...unmoved(KEY, 2), movedFrom: 1 });

    await useCase.execute(allowed(), input);

    expect(queue.published).toHaveLength(1);
  });

  // The actor rides in the payload because the job's own principal is the system's,
  // and one id per tenant makes a second click while queued the same job.
  it("queues the move on the maintenance queue, naming who asked", async () => {
    const { queue, useCase } = build();

    const result = await useCase.execute(allowed(), input);

    expect(result.jobId).toBe(`tenant-move.${TENANT}`);
    expect(result.jobId).not.toContain(":");
    expect(queue.published).toEqual([
      {
        queue: QueueName.MAINTENANCE,
        payload: { organizationId: TENANT, toNode: 1, actorId: ACTOR },
        options: { inFlightId: `tenant-move.${TENANT}`, name: "tenant-move" },
      },
    ]);
  });

  it("records the request against the platform organization", async () => {
    const { activity, useCase } = build();

    await useCase.execute(allowed(), input);

    expect(activity.rows).toEqual([
      {
        organizationId: PLATFORM,
        action: "tenant.move_requested",
        payload: { organizationId: TENANT, slug: "acme", fromNode: 0, toNode: 1 },
      },
    ]);
  });
});
