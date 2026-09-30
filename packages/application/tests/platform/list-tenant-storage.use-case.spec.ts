import { Identifiers } from "@loadbearing/contracts";
import { ForbiddenError } from "@loadbearing/errors";
import { CapabilitySet, type PermissionKey } from "@loadbearing/permissions";
import { describe, expect, it } from "vitest";
import { ListTenantStorageUseCase } from "../../src/platform/list-tenant-storage.use-case.js";
import type {
  TenantStorageMonth,
  TenantStoragePage,
  TenantStorageReader,
  TenantStorageRow,
} from "../../src/platform/tenant-storage.reader.js";
import { Authorizer } from "../../src/primitive/authorizer.js";
import { Principal } from "../../src/primitive/principal.js";

const ORG = Identifiers.organizationId.parse("018f8c00-0000-7000-8000-000000000010");
const OTHER = Identifiers.organizationId.parse("018f8c00-0000-7000-8000-000000000012");
const ACTOR = Identifiers.userId.parse("018f8c00-0000-7000-8000-000000000011");

const ROW: TenantStorageRow = {
  organizationId: OTHER,
  organizationName: "Acme",
  tableName: "activity_log",
  bytes: 2048,
  rows: 10,
  months: 2,
};

const MONTH: TenantStorageMonth = {
  tableName: "activity_log",
  period: "2026-01-01",
  bytes: 1024,
  rows: 5,
  actionCounts: { "task.created": 5 },
  projectedAt: null,
};

// Records the narrowing, because that is the whole difference between the two reads:
// a filter applied after the page was cut would return fewer rows than the limit.
class RecordingStorage implements TenantStorageReader {
  public readonly pages: { limit: number; offset: number; organizationId: string | null }[] = [];
  public readonly months: string[] = [];

  public byTenant(
    page: { limit: number; offset: number },
    organizationId: string | null,
  ): Promise<TenantStoragePage> {
    this.pages.push({ ...page, organizationId });
    return Promise.resolve({ items: [ROW], total: 1 });
  }

  public monthsFor(organizationId: string): Promise<readonly TenantStorageMonth[]> {
    this.months.push(organizationId);
    return Promise.resolve([MONTH]);
  }
}

const actor = (...platform: readonly PermissionKey[]): Principal =>
  new Principal(
    ORG,
    ACTOR,
    CapabilitySet.from({
      wildcard: false,
      org: { grants: [], denies: [] },
      goals: {},
      platform: { grants: platform, denies: [] },
    }),
  );

const useCase = (storage: TenantStorageReader) =>
  new ListTenantStorageUseCase(new Authorizer(), storage);

describe("ListTenantStorageUseCase", () => {
  it("refuses an actor without the platform read", async () => {
    await expect(
      useCase(new RecordingStorage()).execute(actor(), { limit: 25, offset: 0 }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  // The league table: no tenant named, so no per-month read either. That second query
  // is months × tables across every tenant, which is the one this must not run.
  it("reads no months when no tenant is named", async () => {
    const storage = new RecordingStorage();
    const result = await useCase(storage).execute(actor("platform.storage.read"), {
      limit: 25,
      offset: 0,
    });

    expect(storage.pages).toEqual([{ limit: 25, offset: 0, organizationId: null }]);
    expect(storage.months).toEqual([]);
    expect(result).toEqual({ items: [ROW], total: 1, limit: 25, offset: 0, months: [] });
  });

  it("narrows the page and fills the months when one is", async () => {
    const storage = new RecordingStorage();
    const result = await useCase(storage).execute(actor("platform.storage.read"), {
      limit: 10,
      offset: 20,
      organizationId: OTHER,
    });

    expect(storage.pages).toEqual([{ limit: 10, offset: 20, organizationId: OTHER }]);
    expect(storage.months).toEqual([OTHER]);
    expect(result.months).toEqual([MONTH]);
  });

  // The tenant comes off the input, not off the principal: a platform admin is signed
  // into the platform organization and is asking about somebody else's.
  it("does not substitute the actor's own organization", async () => {
    const storage = new RecordingStorage();
    await useCase(storage).execute(actor("platform.storage.read"), { limit: 25, offset: 0 });

    expect(storage.pages[0]?.organizationId).toBeNull();
  });
});
