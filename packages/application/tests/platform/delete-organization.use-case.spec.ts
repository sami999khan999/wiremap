import { Identifiers } from "@loadbearing/contracts";
import { ConflictError, ForbiddenError, NotFoundError } from "@loadbearing/errors";
import { CapabilitySet, type PermissionKey } from "@loadbearing/permissions";
import { describe, expect, it } from "vitest";
import { DeleteOrganizationUseCase } from "../../src/platform/delete-organization.use-case.js";
import type { PlatformReader } from "../../src/platform/platform.reader.js";
import type { TenantRecord, TenantRepository } from "../../src/platform/tenant.repository.js";
import type { ActivityLogger, JobOptions, QueuePublisher } from "../../src/port/index.js";
import { Authorizer } from "../../src/primitive/authorizer.js";
import { Principal } from "../../src/primitive/principal.js";
import { QueueName } from "../../src/primitive/queue-name.js";

const PLATFORM = Identifiers.organizationId.parse("018f8c00-0000-7000-8000-000000000001");
const TENANT = Identifiers.organizationId.parse("018f8c00-0000-7000-8000-000000000010");
const ACTOR = Identifiers.userId.parse("018f8c00-0000-7000-8000-000000000011");

const TENANT_ROW: TenantRecord = { id: TENANT, slug: "acme", name: "Acme", isPlatform: false };

class FakeTenants implements TenantRepository {
  public constructor(private readonly row: TenantRecord | null = TENANT_ROW) {}

  public findBy(): Promise<TenantRecord | null> {
    return Promise.resolve(this.row);
  }

  public delete(): Promise<void> {
    return Promise.reject(new Error("the requester never deletes; the job does"));
  }
}

class FakeQueue implements Partial<QueuePublisher> {
  public readonly published: { queue: string; payload: unknown; options?: JobOptions }[] = [];

  public publish(queue: string, payload: unknown, options?: JobOptions): Promise<void> {
    this.published.push({ queue, payload, options });
    return Promise.resolve();
  }
}

class FakeActivity implements ActivityLogger {
  public readonly rows: { organizationId: string; action: string }[] = [];

  public record(actor: Principal, action: string): Promise<void> {
    this.rows.push({ organizationId: actor.organizationId, action });
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

const build = (tenants: FakeTenants = new FakeTenants()) => {
  const queue = new FakeQueue();
  const activity = new FakeActivity();
  const platform = {
    organizationId: () => Promise.resolve(PLATFORM),
  } as unknown as PlatformReader;

  return {
    queue,
    activity,
    useCase: new DeleteOrganizationUseCase(
      new Authorizer(),
      tenants,
      queue as unknown as QueuePublisher,
      platform,
      activity,
    ),
  };
};

const input = { organizationId: TENANT, slug: "acme" };
const allowed = () => actor("platform.tenant.manage");

// The request half. Every guard runs here rather than in the job, so a mistake is a
// sentence on the screen rather than a worker failure nobody is watching.
describe("DeleteOrganizationUseCase", () => {
  it("refuses an actor without the platform key", async () => {
    await expect(build().useCase.execute(actor(), input)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("is NOT_FOUND for a tenant that is already gone", async () => {
    const { useCase } = build(new FakeTenants(null));
    await expect(useCase.execute(allowed(), input)).rejects.toBeInstanceOf(NotFoundError);
  });

  // The tier holds the platform roles every admin's capability comes from, this one
  // included: deleting it locks the deployment out of its own platform screens.
  it("refuses the platform organization", async () => {
    const tenants = new FakeTenants({ ...TENANT_ROW, isPlatform: true });
    await expect(build(tenants).useCase.execute(allowed(), input)).rejects.toBeInstanceOf(
      ConflictError,
    );
  });

  it("refuses a slug that does not match", async () => {
    await expect(
      build().useCase.execute(allowed(), { organizationId: TENANT, slug: "acme-inc" }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  // Nothing is queued until every guard has passed, which is what makes a refusal cost
  // no work at all rather than a job that starts and then finds out.
  it("queues nothing when a guard refuses", async () => {
    const { queue, useCase } = build();

    await expect(
      useCase.execute(allowed(), { organizationId: TENANT, slug: "wrong" }),
    ).rejects.toThrow();

    expect(queue.published).toEqual([]);
  });

  // The actor rides in the payload because the job's own principal is the system's.
  // Without it the audit row for the delete would name nobody.
  it("queues the purge on the maintenance queue, naming who asked", async () => {
    const { queue, useCase } = build();

    const result = await useCase.execute(allowed(), input);

    expect(result.jobId).toBe(`tenant-delete.${TENANT}`);
    expect(queue.published).toHaveLength(1);
    expect(queue.published[0]?.queue).toBe(QueueName.MAINTENANCE);
    expect(queue.published[0]?.payload).toEqual({ organizationId: TENANT, actorId: ACTOR });
    expect(queue.published[0]?.options?.name).toBe("tenant-delete");
  });

  // BullMQ rejects a colon in a job id, and one id per tenant means a second click
  // while the first is still queued is the same job rather than a second pass.
  it("gives the job an id with no colon in it", async () => {
    const { queue, useCase } = build();
    await useCase.execute(allowed(), input);

    // In flight only (`CR.18`): a fixed `jobId` swallowed a retry for as long as the
    // failed job was kept, and the audit row still said it was requested.
    expect(queue.published[0]?.options?.inFlightId).toBe(`tenant-delete.${TENANT}`);
    expect(queue.published[0]?.options?.jobId).toBeUndefined();
    expect(queue.published[0]?.options?.inFlightId).not.toContain(":");
  });

  // Rebased onto the tier, like `tenant.deleted` is: under the tenant it would be a
  // partition the job is about to drop.
  it("records the request under the platform organization", async () => {
    const { activity, useCase } = build();
    await useCase.execute(allowed(), input);

    expect(activity.rows).toEqual([
      { organizationId: PLATFORM, action: "tenant.delete_requested" },
    ]);
  });
});
