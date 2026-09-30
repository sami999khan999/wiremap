import type { DomainEventInput } from "@loadbearing/contracts";
import { Identifiers, type OrganizationId, type RoleId, type UserId } from "@loadbearing/contracts";
import { ConflictError, ForbiddenError, NotFoundError } from "@loadbearing/errors";
import { CapabilitySet, EntitlementMask, type PermissionKey } from "@loadbearing/permissions";
import { describe, expect, it } from "vitest";
import { ChangeMemberRoleUseCase } from "../../src/member/change-member-role.use-case.js";
import type {
  MemberPage,
  MemberRecord,
  MemberRepository,
} from "../../src/member/member.repository.js";
import { SetMemberActiveUseCase } from "../../src/member/set-member-active.use-case.js";
import type {
  ActivityLogger,
  CapabilityInvalidator,
  DomainEventPublisher,
  UnitOfWork,
} from "../../src/port/index.js";
import { Authorizer } from "../../src/primitive/authorizer.js";
import { Principal } from "../../src/primitive/principal.js";
import type { CapabilityRepository } from "../../src/rbac/capability.repository.js";
import type { RolePage, RoleRecord, RoleRepository } from "../../src/rbac/role.repository.js";

const ORG = Identifiers.organizationId.parse("018f8c00-0000-7000-8000-000000000010");
const ACTOR = Identifiers.userId.parse("018f8c00-0000-7000-8000-000000000011");
const TARGET = Identifiers.userId.parse("018f8c00-0000-7000-8000-000000000012");
const OWNER_ROLE = Identifiers.roleId.parse("018f8c00-0000-7000-8000-0000000000c1");
const MEMBER_ROLE = Identifiers.roleId.parse("018f8c00-0000-7000-8000-0000000000c2");
// The two scopes a membership must tell apart: `goal` belongs on `goal_members`, and
// `platform` is `platform_admin`, which *is* a membership in the tier.
const GOAL_ROLE = Identifiers.roleId.parse("018f8c00-0000-7000-8000-0000000000c3");
const PLATFORM_ROLE = Identifiers.roleId.parse("018f8c00-0000-7000-8000-0000000000c4");

const CLOCK = { now: () => new Date("2026-09-06T00:00:00.000Z") };

function actorHolding(...grants: readonly PermissionKey[]): Principal {
  return new Principal(
    ORG,
    ACTOR,
    CapabilitySet.from({ wildcard: false, org: { grants, denies: [] }, goals: {} }),
  );
}

function member(overrides: Partial<MemberRecord> = {}): MemberRecord {
  return {
    userId: TARGET,
    name: "Grace",
    email: "grace@example.test",
    roleId: OWNER_ROLE,
    roleKey: "owner",
    roleName: "Owner",
    joinedAt: new Date("2026-09-01T00:00:00Z"),
    deactivated: false,
    suspended: false,
    exceptions: 0,
    ...overrides,
  };
}

// Answers for one tenant only, which is what the "another tenant's id" cases pin.
class RecordingMembers implements MemberRepository {
  public readonly roleChanges: { userId: UserId; roleId: RoleId }[] = [];
  public readonly deactivations: { userId: UserId; at: Date | null }[] = [];
  public locked = 0;

  public constructor(
    private readonly row: MemberRecord | null,
    private readonly activeOwners: number,
  ) {}

  public list(): Promise<MemberPage> {
    throw new Error("not under test");
  }

  public existsByEmail(): Promise<boolean> {
    throw new Error("not under test");
  }

  public findByUser(organizationId: OrganizationId, userId: UserId): Promise<MemberRecord | null> {
    if (organizationId !== ORG || !this.row || this.row.userId !== userId) {
      return Promise.resolve(null);
    }
    return Promise.resolve(this.row);
  }

  public changeRole(_org: OrganizationId, userId: UserId, roleId: RoleId): Promise<void> {
    this.roleChanges.push({ userId, roleId });
    return Promise.resolve();
  }

  public setDeactivatedAt(_org: OrganizationId, userId: UserId, at: Date | null): Promise<void> {
    this.deactivations.push({ userId, at });
    return Promise.resolve();
  }

  public countActiveOwners(): Promise<number> {
    return Promise.resolve(this.activeOwners);
  }

  // The same answer, and it records that the locking read is the one taken: the
  // unlocked count outside the transaction is exactly what the race exploited.
  public lockActiveOwners(): Promise<number> {
    this.locked += 1;
    return Promise.resolve(this.activeOwners);
  }
}

const UNLIMITED = EntitlementMask.from({
  plan: "all",
  added: [],
  removed: [],
  disabledModules: [],
});

// Only the ceiling is under test; resolution is the adapter's, and is not asked for here.
const planOf = (mask: EntitlementMask) =>
  ({ entitlementFor: () => Promise.resolve(mask) }) as unknown as CapabilityRepository;

class StubRoles implements RoleRepository {
  public list(): Promise<RolePage> {
    throw new Error("not under test");
  }

  public findByKey(): Promise<RoleRecord | null> {
    throw new Error("not under test");
  }

  public save(): Promise<void> {
    throw new Error("not under test");
  }

  public delete(): Promise<void> {
    throw new Error("not under test");
  }

  public countAssignments(): Promise<number> {
    throw new Error("not under test");
  }

  public findById(organizationId: OrganizationId, roleId: RoleId): Promise<RoleRecord | null> {
    if (organizationId !== ORG) return Promise.resolve(null);
    if (roleId === OWNER_ROLE) {
      return Promise.resolve({
        id: OWNER_ROLE,
        key: "owner",
        name: "Owner",
        description: null,
        scope: "org",
        isSystem: true,
        permissions: ["member.invite"],
      });
    }
    if (roleId === MEMBER_ROLE) {
      return Promise.resolve({
        id: MEMBER_ROLE,
        key: "member",
        name: "Member",
        description: null,
        scope: "org",
        isSystem: true,
        permissions: [],
      });
    }
    if (roleId === GOAL_ROLE || roleId === PLATFORM_ROLE) {
      return Promise.resolve({
        id: roleId,
        key: roleId === GOAL_ROLE ? "goal_reviewer" : "platform_admin",
        name: "Scoped",
        description: null,
        scope: roleId === GOAL_ROLE ? "goal" : "platform",
        isSystem: false,
        permissions: [],
      });
    }
    return Promise.resolve(null);
  }
  public savePermission(): Promise<void> {
    throw new Error("not under test");
  }

  public deletePermission(): Promise<void> {
    throw new Error("not under test");
  }
}

class RecordingActivityLogger implements ActivityLogger {
  public readonly records: { action: string; payload: Record<string, unknown> }[] = [];

  public record(
    _actor: Principal,
    action: string,
    payload: Readonly<Record<string, unknown>>,
  ): Promise<void> {
    this.records.push({ action, payload: { ...payload } });
    return Promise.resolve();
  }
}

class RecordingDomainEventPublisher implements DomainEventPublisher {
  public readonly published: { name: string; payload: Record<string, unknown> }[] = [];

  public publish(_actor: Principal, event: DomainEventInput): Promise<void> {
    this.published.push({ name: event.name, payload: { ...event.payload } });
    return Promise.resolve();
  }
}

class DirectUnitOfWork implements UnitOfWork {
  public run<T>(work: () => Promise<T>): Promise<T> {
    return work();
  }
}

class RecordingCapabilities implements CapabilityInvalidator {
  public readonly flushed: string[] = [];

  public invalidate(organizationId: OrganizationId, userId: UserId): Promise<void> {
    this.flushed.push(`${organizationId}:${userId}`);
    return Promise.resolve();
  }

  public invalidateOrganization(organizationId: OrganizationId): Promise<void> {
    this.flushed.push(organizationId);
    return Promise.resolve();
  }

  // The adapter decides when this fires — it is the only thing that knows which tenant
  // is the tier — so a use-case calling it directly is the bug this throw names.
  public invalidateAll(): Promise<void> {
    throw new Error("only a plan edit or the kill switch flushes every tenant");
  }

  public invalidatePlatform(): Promise<void> {
    throw new Error("the cache flushes the platform axis, never a use-case");
  }
}

const changeRole = (
  members: RecordingMembers,
  activity = new RecordingActivityLogger(),
  capabilities = new RecordingCapabilities(),
  events = new RecordingDomainEventPublisher(),
  entitlement: EntitlementMask = UNLIMITED,
) => ({
  activity,
  capabilities,
  events,
  useCase: new ChangeMemberRoleUseCase(
    new Authorizer(),
    members,
    new StubRoles(),
    capabilities,
    activity,
    events,
    new DirectUnitOfWork(),
    planOf(entitlement),
  ),
});

const setActive = (
  members: RecordingMembers,
  activity = new RecordingActivityLogger(),
  capabilities = new RecordingCapabilities(),
) => ({
  activity,
  capabilities,
  useCase: new SetMemberActiveUseCase(
    new Authorizer(),
    members,
    capabilities,
    activity,
    new DirectUnitOfWork(),
    CLOCK,
  ),
});

describe("ChangeMemberRoleUseCase", () => {
  it("refuses a principal without member.role.change", async () => {
    const { useCase } = changeRole(new RecordingMembers(member(), 2));

    await expect(
      useCase.execute(actorHolding("member.read"), { userId: TARGET, roleId: MEMBER_ROLE }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  // `CR.1`. The role is the actor's tenant's and not a goal role, and still it hands out
  // more than the actor holds: that is a takeover, not a role change.
  it("refuses to hand out a role granting a key the actor does not hold", async () => {
    const members = new RecordingMembers(member({ roleId: MEMBER_ROLE, roleKey: "member" }), 2);
    const { useCase } = changeRole(members);

    await expect(
      useCase.execute(actorHolding("member.role.change"), { userId: TARGET, roleId: OWNER_ROLE }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(members.roleChanges).toEqual([]);
  });

  // `RV.10`. Grants are filtered, never deleted, so `owner` still lists a key the plan took
  // away, and nobody holds it. Without the skip, no owner could ever be appointed again.
  it("hands out a role whose extra keys the org is not entitled to", async () => {
    const members = new RecordingMembers(member({ roleId: MEMBER_ROLE, roleKey: "member" }), 2);
    const smaller = EntitlementMask.from({
      plan: ["member.role.change", "member.read"],
      added: [],
      removed: [],
      disabledModules: [],
    });
    const { useCase } = changeRole(members, undefined, undefined, undefined, smaller);

    await useCase.execute(actorHolding("member.role.change"), {
      userId: TARGET,
      roleId: OWNER_ROLE,
    });

    expect(members.roleChanges).toHaveLength(1);
  });

  it("does not find a member of another tenant", async () => {
    const { useCase } = changeRole(new RecordingMembers(null, 2));

    await expect(
      useCase.execute(actorHolding("member.role.change", "member.invite"), {
        userId: TARGET,
        roleId: MEMBER_ROLE,
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  // The rule this whole use-case exists around: nobody left who can promote an owner
  // means the tenant cannot be recovered from inside the product.
  it("refuses to demote the last active owner", async () => {
    const members = new RecordingMembers(member(), 1);
    const { useCase } = changeRole(members);

    await expect(
      useCase.execute(actorHolding("member.role.change", "member.invite"), {
        userId: TARGET,
        roleId: MEMBER_ROLE,
      }),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(members.roleChanges).toEqual([]);
  });

  it("demotes an owner while another active owner remains", async () => {
    const members = new RecordingMembers(member(), 2);
    const { useCase, activity, events } = changeRole(members);

    const result = await useCase.execute(actorHolding("member.role.change", "member.invite"), {
      userId: TARGET,
      roleId: MEMBER_ROLE,
    });

    expect(result.roleKey).toBe("member");
    expect(members.roleChanges).toEqual([{ userId: TARGET, roleId: MEMBER_ROLE }]);
    expect(activity.records.map((r) => r.action)).toEqual(["member.role.changed"]);

    // One event, carrying both roles: a subscriber that needs to know what changed
    // should not have to read the row back to find out what it used to be.
    expect(events.published).toEqual([
      {
        name: "member.role.changed",
        payload: { userId: TARGET, roleId: MEMBER_ROLE, previousRoleId: OWNER_ROLE },
      },
    ]);
  });

  // Without this the demotion is invisible for a minute: `CapabilityCache` keeps the
  // old role's resolved set, so the demoted member keeps acting as an owner.
  it("flushes the cached capability set for the member whose role moved", async () => {
    const members = new RecordingMembers(member(), 2);
    const { useCase, capabilities } = changeRole(members);

    await useCase.execute(actorHolding("member.role.change", "member.invite"), {
      userId: TARGET,
      roleId: MEMBER_ROLE,
    });

    expect(capabilities.flushed).toEqual([`${ORG}:${TARGET}`]);
  });

  // The one path that writes nothing must also flush nothing, or every no-op role
  // change costs the member a re-resolve.
  it("flushes nothing when the role is already the one asked for", async () => {
    const { useCase, capabilities } = changeRole(new RecordingMembers(member(), 2));

    await useCase.execute(actorHolding("member.role.change", "member.invite"), {
      userId: TARGET,
      roleId: OWNER_ROLE,
    });

    expect(capabilities.flushed).toEqual([]);
  });

  // Promotion is never the last-owner case, so the count is not even read.
  it("promotes to owner without consulting the owner count", async () => {
    const members = new RecordingMembers(member({ roleId: MEMBER_ROLE, roleKey: "member" }), 1);
    const { useCase } = changeRole(members);

    const result = await useCase.execute(actorHolding("member.role.change", "member.invite"), {
      userId: TARGET,
      roleId: OWNER_ROLE,
    });

    expect(result.roleKey).toBe("owner");
  });

  it("writes nothing when the role is already the one asked for", async () => {
    const members = new RecordingMembers(member(), 2);
    const { useCase, activity, events } = changeRole(members);

    await useCase.execute(actorHolding("member.role.change", "member.invite"), {
      userId: TARGET,
      roleId: OWNER_ROLE,
    });

    expect(members.roleChanges).toEqual([]);
    expect(activity.records).toEqual([]);
    // A change that did not happen announces nothing. Publishing here would wake every
    // subscriber for a no-op.
    expect(events.published).toEqual([]);
  });
});

describe("SetMemberActiveUseCase", () => {
  it("refuses a principal without member.deactivate", async () => {
    const { useCase } = setActive(new RecordingMembers(member(), 2));

    await expect(
      useCase.execute(actorHolding("member.read"), { userId: TARGET }, false),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("refuses to deactivate the last active owner", async () => {
    const members = new RecordingMembers(member(), 1);
    const { useCase } = setActive(members);

    await expect(
      useCase.execute(actorHolding("member.deactivate"), { userId: TARGET }, false),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(members.deactivations).toEqual([]);
  });

  // Locking yourself out is recoverable by a colleague; it is still never what the
  // click meant, and the button that would do it is hidden for the same reason.
  it("refuses to deactivate your own membership", async () => {
    const members = new RecordingMembers(member({ userId: ACTOR }), 3);
    const { useCase } = setActive(members);

    await expect(
      useCase.execute(actorHolding("member.deactivate"), { userId: ACTOR }, false),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("stamps the clock on deactivation and clears it on reactivation", async () => {
    const members = new RecordingMembers(member({ roleKey: "member" }), 2);
    const { useCase, activity } = setActive(members);

    await useCase.execute(actorHolding("member.deactivate"), { userId: TARGET }, false);
    expect(members.deactivations).toEqual([{ userId: TARGET, at: CLOCK.now() }]);
    expect(activity.records.map((r) => r.action)).toEqual(["member.deactivated"]);

    const back = new RecordingMembers(member({ roleKey: "member", deactivated: true }), 2);
    const second = setActive(back);
    await second.useCase.execute(actorHolding("member.deactivate"), { userId: TARGET }, true);

    expect(back.deactivations).toEqual([{ userId: TARGET, at: null }]);
    expect(second.activity.records.map((r) => r.action)).toEqual(["member.reactivated"]);
  });

  // `CR.2`: the cached set outlived the deactivation by a minute, and the platform axis
  // with it — a deactivated platform admin kept platform rights in every other tenant.
  it("flushes the member's cached capabilities after the commit", async () => {
    const members = new RecordingMembers(member({ roleKey: "member" }), 2);
    const { useCase, capabilities } = setActive(members);

    await useCase.execute(actorHolding("member.deactivate"), { userId: TARGET }, false);

    expect(capabilities.flushed).toEqual([`${ORG}:${TARGET}`]);
  });

  it("writes nothing when the membership is already in the state asked for", async () => {
    const members = new RecordingMembers(member({ roleKey: "member" }), 2);
    const { useCase, activity } = setActive(members);

    await useCase.execute(actorHolding("member.deactivate"), { userId: TARGET }, true);

    expect(members.deactivations).toEqual([]);
    expect(activity.records).toEqual([]);
  });
});

// `R.19`: both use-cases read the owner count before the transaction, so two concurrent
// demotions each saw two owners and the tenant committed its way down to none.
describe("the last-owner rule takes the locking read", () => {
  it("locks the owner rows rather than counting them unlocked", async () => {
    const members = new RecordingMembers(member(), 2);
    const { useCase } = changeRole(members);

    await useCase.execute(actorHolding("member.role.change", "member.invite"), {
      userId: TARGET,
      roleId: MEMBER_ROLE,
    });

    expect(members.locked).toBe(1);
  });

  it("locks before deactivating an owner too", async () => {
    const members = new RecordingMembers(member(), 2);
    const { useCase } = setActive(members);

    await useCase.execute(actorHolding("member.deactivate"), { userId: TARGET }, false);

    expect(members.locked).toBe(1);
  });

  // Promotion and reactivation touch no owner floor, so a lock there would serialise
  // every membership edit in the tenant behind one row.
  it("takes no lock when the change cannot drop the owner count", async () => {
    const members = new RecordingMembers(member(), 2);
    const { useCase } = setActive(members);

    await useCase.execute(actorHolding("member.deactivate"), { userId: TARGET }, false);
    const after = new RecordingMembers({ ...member(), deactivated: true }, 2);

    await setActive(after).useCase.execute(
      actorHolding("member.deactivate"),
      { userId: TARGET },
      true,
    );

    expect(after.locked).toBe(0);
  });
});

// `R.37`. A goal role belongs on `goal_members`. Assigned as a membership it would hand
// its keys out across the whole tenant instead of inside one goal.
describe("a membership role cannot be goal-scoped", () => {
  it("refuses to change a member onto a goal role", async () => {
    const members = new RecordingMembers(member(), 2);
    const { useCase } = changeRole(members);

    await expect(
      useCase.execute(actorHolding("member.role.change", "member.invite"), {
        userId: TARGET,
        roleId: GOAL_ROLE,
      }),
    ).rejects.toBeInstanceOf(ConflictError);

    expect(members.roleChanges).toEqual([]);
  });

  // `platform_admin` is `scope: "platform"` and *is* a membership row, in the one
  // organization marked `is_platform`. The rule is "not goal", never "org only".
  it("leaves a platform-scoped role assignable", async () => {
    const members = new RecordingMembers(member(), 2);
    const { useCase } = changeRole(members);

    await useCase.execute(actorHolding("member.role.change", "member.invite"), {
      userId: TARGET,
      roleId: PLATFORM_ROLE,
    });

    expect(members.roleChanges).toHaveLength(1);
  });
});
