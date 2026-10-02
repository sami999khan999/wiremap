import { Identifiers, type OrganizationId } from "@loadbearing/contracts";
import { CapabilitySet, EntitlementMask, type PermissionKey } from "@loadbearing/permissions";
import { describe, expect, it } from "vitest";
import type { MemberRecord, MemberRepository } from "../../src/member/member.repository.js";
import type { PlatformReader } from "../../src/platform/platform.reader.js";
import { Authorizer } from "../../src/primitive/authorizer.js";
import { Principal } from "../../src/primitive/principal.js";
import type { CapabilityRepository } from "../../src/rbac/capability.repository.js";
import { InspectEffectivePermissionsUseCase } from "../../src/rbac/inspect-effective-permissions.use-case.js";

const ORG = Identifiers.organizationId.parse("018f8c00-0000-7000-8000-000000000010");
const OTHER = Identifiers.organizationId.parse("018f8c00-0000-7000-8000-0000000000ff");
const ACTOR = Identifiers.userId.parse("018f8c00-0000-7000-8000-000000000011");
const TARGET = Identifiers.userId.parse("018f8c00-0000-7000-8000-000000000012");

const actor = new Principal(
  ORG,
  ACTOR,
  CapabilitySet.from({
    wildcard: false,
    org: { grants: ["rbac.effective.inspect"], denies: [] },
    goals: {},
  }),
);

const members = {
  findByUser: () => Promise.resolve({ userId: TARGET } as MemberRecord),
} as unknown as MemberRepository;

// The member's role lists a platform key; the platform axis grants it.
const capabilities = {
  explainFor: () =>
    Promise.resolve({
      roleGrants: ["member.read", "platform.account.read"],
      goalGrants: {},
      overrides: [],
      entitlement: EntitlementMask.from({
        plan: "all",
        added: [],
        removed: [],
        disabledModules: [],
      }),
    }),
  resolvePlatformFor: () =>
    Promise.resolve(
      CapabilitySet.from({
        wildcard: false,
        org: { grants: [], denies: [] },
        platform: { grants: ["platform.account.read"], denies: [] },
        goals: {},
      }),
    ),
} as unknown as CapabilityRepository;

const inspect = (platformOrganization: OrganizationId) =>
  new InspectEffectivePermissionsUseCase(new Authorizer(), members, capabilities, {
    organizationId: () => Promise.resolve(platformOrganization),
  } as unknown as PlatformReader);

const held = async (platformOrganization: OrganizationId, key: PermissionKey) =>
  (await inspect(platformOrganization).execute(actor, { userId: TARGET })).capabilities.can(key);

describe("InspectEffectivePermissionsUseCase", () => {
  it("shows a platform key as held inside the platform organization", async () => {
    expect(await held(ORG, "platform.account.read")).toBe(true);
    expect(await held(ORG, "member.read")).toBe(true);
  });

  // A customer tenant's admin must not learn which of their members are platform staff.
  it("never shows the platform axis in a customer tenant", async () => {
    expect(await held(OTHER, "platform.account.read")).toBe(false);
    expect(await held(OTHER, "member.read")).toBe(true);
  });
});
