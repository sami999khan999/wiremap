import { Identifiers } from "@loadbearing/contracts";
import { ForbiddenError, NotFoundError } from "@loadbearing/errors";
import { CapabilitySet, type PermissionKey } from "@loadbearing/permissions";
import { describe, expect, it } from "vitest";
import { ExportOrganizationUseCase } from "../../src/platform/export-organization.use-case.js";
import { ListTenantExportsUseCase } from "../../src/platform/list-tenant-exports.use-case.js";
import type { PlatformReader } from "../../src/platform/platform.reader.js";
import type { TenantRecord, TenantRepository } from "../../src/platform/tenant.repository.js";
import type {
  ActivityLogger,
  JobOptions,
  QueuePublisher,
  StorageGateway,
} from "../../src/port/index.js";
import { Authorizer } from "../../src/primitive/authorizer.js";
import { Principal } from "../../src/primitive/principal.js";

const PLATFORM = Identifiers.organizationId.parse("018f8c00-0000-7000-8000-000000000001");
const TENANT = Identifiers.organizationId.parse("018f8c00-0000-7000-8000-000000000010");
const ACTOR = Identifiers.userId.parse("018f8c00-0000-7000-8000-000000000011");
const NOW = new Date("2026-08-15T09:30:00.000Z");

const TENANT_ROW: TenantRecord = { id: TENANT, slug: "acme", name: "Acme", isPlatform: false };

class FakeTenants implements TenantRepository {
  public constructor(private readonly row: TenantRecord | null = TENANT_ROW) {}

  public findBy(): Promise<TenantRecord | null> {
    return Promise.resolve(this.row);
  }

  public delete(): Promise<void> {
    return Promise.resolve();
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

class FakeStorage implements Partial<StorageGateway> {
  public readonly prefixes: string[] = [];

  public constructor(private readonly keys: readonly string[] = []) {}

  public list(prefix: string): Promise<readonly string[]> {
    this.prefixes.push(prefix);
    return Promise.resolve(this.keys);
  }

  public presignDownload(key: string, expiresInSeconds: number): Promise<string> {
    return Promise.resolve(`https://fake/${key}?expires=${expiresInSeconds}`);
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

const platform = {
  organizationId: () => Promise.resolve(PLATFORM),
  organization: () => Promise.resolve({ id: PLATFORM, slug: "platform", name: "Platform" }),
} as unknown as PlatformReader;

const build = (tenants: TenantRepository = new FakeTenants()) => {
  const queue = new FakeQueue();
  const activity = new FakeActivity();

  return {
    queue,
    activity,
    useCase: new ExportOrganizationUseCase(
      new Authorizer(),
      tenants,
      queue as unknown as QueuePublisher,
      platform,
      activity,
      { now: () => NOW },
    ),
  };
};

describe("ExportOrganizationUseCase", () => {
  it("refuses an actor without the platform key", async () => {
    await expect(
      build().useCase.execute(actor(), { organizationId: TENANT }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  // Checked before the job is queued, so "no such tenant" is an answer on the screen
  // rather than a worker failure nobody is watching.
  it("is NOT_FOUND for a tenant that does not exist", async () => {
    const { useCase } = build(new FakeTenants(null));
    await expect(
      useCase.execute(actor("platform.tenant.manage"), { organizationId: TENANT }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  // **No `:`** — BullMQ rejects a colon in a job id, which is why this is dotted.
  it("queues one job per tenant per day, with a colon-free id", async () => {
    const { queue, useCase } = build();
    const result = await useCase.execute(actor("platform.tenant.manage"), {
      organizationId: TENANT,
    });

    expect(result.jobId).toBe(`tenant-export.${TENANT}.2026-08-15`);
    expect(result.jobId).not.toContain(":");
    expect(queue.published).toEqual([
      {
        queue: "maintenance",
        payload: { organizationId: TENANT, day: "2026-08-15" },
        options: { jobId: result.jobId, name: "tenant-export" },
      },
    ]);
  });

  it("records the request under the platform organization", async () => {
    const { activity, useCase } = build();
    await useCase.execute(actor("platform.tenant.manage"), { organizationId: TENANT });

    expect(activity.rows).toEqual([
      { organizationId: PLATFORM, action: "tenant.export_requested" },
    ]);
  });
});

describe("ListTenantExportsUseCase", () => {
  const useCase = (storage: FakeStorage) =>
    new ListTenantExportsUseCase(new Authorizer(), storage as unknown as StorageGateway);

  it("refuses an actor without the platform key", async () => {
    await expect(
      useCase(new FakeStorage()).execute(actor(), { organizationId: TENANT }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  // The prefix is the tenant's, never the whole bucket: one page is the answer only
  // because the prefix is narrow.
  it("lists one tenant's prefix and presigns every key", async () => {
    const storage = new FakeStorage([
      `export/${TENANT}/2026-08-15/activity_log.ndjson.gz`,
      `export/${TENANT}/2026-08-15/manifest.json`,
    ]);

    const objects = await useCase(storage).execute(actor("platform.tenant.manage"), {
      organizationId: TENANT,
    });

    expect(storage.prefixes).toEqual([`export/${TENANT}/`]);
    expect(objects.map((object) => object.day)).toEqual(["2026-08-15", "2026-08-15"]);
    expect(objects[0]?.url).toContain("expires=900");
  });
});
