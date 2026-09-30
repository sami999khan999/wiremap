import { Identifiers, type OrganizationId, type RoleId, type UserId } from "@loadbearing/contracts";
import { FixedClock } from "@loadbearing/core";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@loadbearing/errors";
import { CapabilitySet, EntitlementMask, type PermissionKey } from "@loadbearing/permissions";
import { describe, expect, it } from "vitest";
import type { MemberRecord, MemberRepository } from "../../src/member/member.repository.js";
import type { ActivityLogger, CapabilityInvalidator, UnitOfWork } from "../../src/port/index.js";
import { Authorizer } from "../../src/primitive/authorizer.js";
import { Principal } from "../../src/primitive/principal.js";
import type {
  CapabilityExplanation,
  CapabilityRepository,
} from "../../src/rbac/capability.repository.js";
import { ClearPermissionOverrideUseCase } from "../../src/rbac/clear-permission-override.use-case.js";
import { DenyPermissionOverrideUseCase } from "../../src/rbac/deny-permission-override.use-case.js";
import { ExpirePermissionOverridesUseCase } from "../../src/rbac/expire-permission-overrides.use-case.js";
import { GrantPermissionOverrideUseCase } from "../../src/rbac/grant-permission-override.use-case.js";
import {
  type OverrideInput,
  type PermissionOverrideRecord,
  PermissionOverrideRepository,
} from "../../src/rbac/permission-override.repository.js";
import type { RoleRecord, RoleRepository } from "../../src/rbac/role.repository.js";

const ORG = Identifiers.organizationId.parse("018f8c00-0000-7000-8000-000000000010");
const ADMIN = Identifiers.userId.parse("018f8c00-0000-7000-8000-000000000011");
const MEMBER = Identifiers.userId.parse("018f8c00-0000-7000-8000-000000000012");
const OWNER = Identifiers.userId.parse("018f8c00-0000-7000-8000-000000000013");
const MEMBER_ROLE = "018f8c00-0000-7000-8000-0000000000a1" as RoleId;
const OWNER_ROLE = "018f8c00-0000-7000-8000-0000000000a2" as RoleId;
const NOW = new Date("2026-09-28T00:00:00Z");
const DAY = 86_400_000;

const UNLIMITED = EntitlementMask.from({
  plan: "all",
  added: [],
  removed: [],
  disabledModules: [],
});

const role = (id: RoleId, key: string, permissions: readonly string[]): RoleRecord => ({
  id,
  key,
  name: key,
  description: null,
  scope: "org",
  isSystem: true,
  permissions,
});

// The member holds the role list, so a grant of `member.invite` needs only `rbac.role.read`
// added. The owner's role lists a key no admin holds, which is what outranking means here.
const ROLES = new Map<RoleId, RoleRecord>([
  [MEMBER_ROLE, role(MEMBER_ROLE, "member", ["member.read"])],
  [OWNER_ROLE, role(OWNER_ROLE, "owner", ["member.read", "rbac.permission.grant"])],
]);

const member = (userId: UserId, roleId: RoleId): MemberRecord => ({
  userId,
  name: "x",
  email: `${userId}@example.test`,
  roleId,
  roleKey: roleId === OWNER_ROLE ? "owner" : "member",
  roleName: "x",
  joinedAt: NOW,
  deactivated: false,
  suspended: false,
  exceptions: 0,
});

const MEMBERS = new Map<UserId, MemberRecord>([
  [ADMIN, member(ADMIN, MEMBER_ROLE)],
  [MEMBER, member(MEMBER, MEMBER_ROLE)],
  [OWNER, member(OWNER, OWNER_ROLE)],
]);

class MemoryOverrides extends PermissionOverrideRepository {
  public readonly rows: PermissionOverrideRecord[] = [];

  public override findFor(organizationId: OrganizationId, userId: UserId) {
    return Promise.resolve(
      this.rows.filter((row) => row.organizationId === organizationId && row.userId === userId),
    );
  }

  public override findById(organizationId: OrganizationId, id: string) {
    return Promise.resolve(
      this.rows.find((row) => row.organizationId === organizationId && row.id === id) ?? null,
    );
  }

  public override save(
    organizationId: OrganizationId,
    userId: UserId,
    rows: readonly OverrideInput[],
    _actor: UserId,
  ): Promise<void> {
    for (const row of rows) {
      const at = this.rows.findIndex(
        (existing) =>
          existing.userId === userId &&
          existing.permission === row.permission &&
          existing.authority === row.authority,
      );
      const record: PermissionOverrideRecord = {
        ...row,
        id: `${row.permission}:${row.authority}`,
        goalId: null,
        organizationId,
        userId,
        createdAt: NOW,
      };
      if (at >= 0) this.rows[at] = record;
      else this.rows.push(record);
    }
    return Promise.resolve();
  }

  public override delete(_organizationId: OrganizationId, id: string): Promise<void> {
    const at = this.rows.findIndex((row) => row.id === id);
    if (at >= 0) this.rows.splice(at, 1);
    return Promise.resolve();
  }

  public override findExpired(now: Date) {
    return Promise.resolve(
      this.rows.filter((row) => row.expiresAt !== null && row.expiresAt <= now),
    );
  }
}

function harness() {
  const overrides = new MemoryOverrides();
  const flushed: string[] = [];
  const recorded: { organizationId: string; action: string }[] = [];
  const invalidator = {
    invalidate: (organizationId: OrganizationId, userId: UserId) => {
      flushed.push(`${organizationId}:${userId}`);
      return Promise.resolve();
    },
  } as unknown as CapabilityInvalidator;
  const activity: ActivityLogger = {
    record: (actor, action) => {
      recorded.push({ organizationId: actor.organizationId, action });
      return Promise.resolve();
    },
  };
  const unitOfWork = { run: <T>(work: () => Promise<T>) => work() } as UnitOfWork;
  const members = {
    findByUser: (_org: OrganizationId, userId: UserId) =>
      Promise.resolve(MEMBERS.get(userId) ?? null),
  } as unknown as MemberRepository;
  const roles = {
    findById: (_org: OrganizationId, id: RoleId) => Promise.resolve(ROLES.get(id) ?? null),
  } as unknown as RoleRepository;
  // The target's current answer: their role's keys, and the plan. Overrides are not
  // replayed here — each case starts from the role alone.
  const capabilities = {
    entitlementFor: () => Promise.resolve(UNLIMITED),
    explainFor: (_org: OrganizationId, userId: UserId): Promise<CapabilityExplanation> =>
      Promise.resolve({
        roleGrants: ROLES.get(MEMBERS.get(userId)?.roleId ?? MEMBER_ROLE)?.permissions ?? [],
        goalGrants: {},
        overrides: [],
        entitlement: UNLIMITED,
      }),
  } as unknown as CapabilityRepository;
  const authorizer = new Authorizer();
  const shared = [
    members,
    roles,
    capabilities,
    overrides,
    invalidator,
    activity,
    unitOfWork,
  ] as const;

  return {
    overrides,
    flushed,
    recorded,
    grant: new GrantPermissionOverrideUseCase(authorizer, ...shared, new FixedClock(NOW)),
    deny: new DenyPermissionOverrideUseCase(authorizer, ...shared),
    clear: new ClearPermissionOverrideUseCase(authorizer, ...shared),
    expire: new ExpirePermissionOverridesUseCase(overrides, invalidator, activity, unitOfWork),
  };
}

const admin = (...grants: readonly PermissionKey[]) =>
  new Principal(
    ORG,
    ADMIN,
    CapabilitySet.from({
      wildcard: false,
      org: { grants: ["rbac.override.manage", "rbac.override.read", ...grants], denies: [] },
      goals: {},
    }),
  );

const holder = admin("member.read", "member.invite", "rbac.role.read", "analytics.activity.read");

describe("GrantPermissionOverrideUseCase", () => {
  it("defaults to thirty days, and brings what the key needs and the person lacks", async () => {
    const { grant, overrides, flushed, recorded } = harness();

    const keys = await grant.execute(holder, {
      userId: MEMBER,
      permission: "member.invite",
      reason: "covering the front desk",
      expiresAt: null,
    });

    expect(keys).toEqual(["member.invite", "rbac.role.read"]);
    expect(
      overrides.rows.every((row) => row.expiresAt?.getTime() === NOW.getTime() + 30 * DAY),
    ).toBe(true);
    expect(overrides.rows.every((row) => row.reason === "covering the front desk")).toBe(true);
    expect(flushed).toEqual([`${ORG}:${MEMBER}`]);
    expect(recorded.map((entry) => entry.action)).toEqual(["override.granted"]);
  });

  it("refuses an expiry past ninety days, one in the past, and a grant with no reason", async () => {
    const { grant } = harness();
    const base = { userId: MEMBER, permission: "analytics.activity.read", reason: "x" };

    await expect(
      grant.execute(holder, { ...base, expiresAt: new Date(NOW.getTime() + 91 * DAY) }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      grant.execute(holder, { ...base, expiresAt: new Date(NOW.getTime() - 1) }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      grant.execute(holder, { ...base, reason: "  ", expiresAt: null }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  // No escalation: an exception cannot hand out what the actor does not hold, and that
  // includes every key the closure brings along.
  it("refuses a key the actor does not hold, or a requirement it does not", async () => {
    const { grant, overrides } = harness();

    await expect(
      grant.execute(admin("member.read"), {
        userId: MEMBER,
        permission: "analytics.activity.read",
        reason: "x",
        expiresAt: null,
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      grant.execute(admin("member.invite"), {
        userId: MEMBER,
        permission: "member.invite",
        reason: "x",
        expiresAt: null,
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(overrides.rows).toEqual([]);
  });

  it("refuses the actor themselves, someone who outranks them, and core or platform keys", async () => {
    const { grant } = harness();
    const base = { permission: "analytics.activity.read", reason: "x", expiresAt: null };

    await expect(grant.execute(holder, { ...base, userId: ADMIN })).rejects.toBeInstanceOf(
      ConflictError,
    );
    await expect(grant.execute(holder, { ...base, userId: OWNER })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    for (const permission of ["core.activity.write", "platform.status.read"]) {
      await expect(
        grant.execute(holder, { ...base, userId: MEMBER, permission }),
      ).rejects.toBeInstanceOf(ValidationError);
    }
  });

  it("answers NOT_FOUND for someone who is not a member", async () => {
    const { grant } = harness();

    await expect(
      grant.execute(holder, {
        userId: Identifiers.userId.parse("018f8c00-0000-7000-8000-0000000000ff"),
        permission: "analytics.activity.read",
        reason: "x",
        expiresAt: null,
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("DenyPermissionOverrideUseCase", () => {
  // `RV.13`: without the role list the invite form's picker is empty, so it goes too.
  it("is permanent, and takes what depends on the key", async () => {
    const { deny, overrides } = harness();

    const keys = await deny.execute(holder, {
      userId: MEMBER,
      permission: "rbac.role.read",
      reason: null,
    });

    expect(keys).toContain("member.invite");
    expect(overrides.rows.every((row) => row.effect === "deny" && row.expiresAt === null)).toBe(
      true,
    );
  });
});

describe("ClearPermissionOverrideUseCase", () => {
  it("clears an org row and flushes the person", async () => {
    const { deny, clear, overrides, flushed } = harness();
    await deny.execute(holder, {
      userId: MEMBER,
      permission: "analytics.activity.read",
      reason: null,
    });
    flushed.length = 0;

    await clear.execute(holder, { overrideId: "analytics.activity.read:org" });

    expect(overrides.rows).toEqual([]);
    expect(flushed).toEqual([`${ORG}:${MEMBER}`]);
  });

  // The tier's deny is shown to the org and is not the org's to lift.
  it("refuses to clear a platform deny", async () => {
    const { clear, overrides } = harness();
    await overrides.save(
      ORG,
      MEMBER,
      [
        {
          permission: "analytics.activity.read",
          effect: "deny",
          reason: null,
          expiresAt: null,
          authority: "platform",
        },
      ],
      ADMIN,
    );

    await expect(
      clear.execute(holder, { overrideId: "analytics.activity.read:platform" }),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(overrides.rows).toHaveLength(1);
  });
});

describe("ExpirePermissionOverridesUseCase", () => {
  it("removes each expired grant, audits it in its org, and flushes that person", async () => {
    const { grant, expire, overrides, recorded, flushed } = harness();
    await grant.execute(holder, {
      userId: MEMBER,
      permission: "analytics.activity.read",
      reason: "trial",
      expiresAt: new Date(NOW.getTime() + DAY),
    });
    recorded.length = 0;
    flushed.length = 0;

    const system = new Principal(ORG, ADMIN, CapabilitySet.empty(), "system");
    expect(await expire.execute(system, new Date(NOW.getTime() + 2 * DAY))).toEqual({
      overrides: 1,
    });

    expect(overrides.rows).toEqual([]);
    expect(recorded).toEqual([{ organizationId: ORG, action: "override.expired" }]);
    expect(flushed).toEqual([`${ORG}:${MEMBER}`]);
  });
});
