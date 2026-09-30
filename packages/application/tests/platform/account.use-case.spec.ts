import { Identifiers, type OrganizationId, type UserId } from "@loadbearing/contracts";
import { FixedClock } from "@loadbearing/core";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@loadbearing/errors";
import { CapabilitySet, type PermissionKey } from "@loadbearing/permissions";
import { describe, expect, it } from "vitest";
import { type AccountRecord, AccountRepository } from "../../src/platform/account.repository.js";
import { ClearAccountDenyUseCase } from "../../src/platform/clear-account-deny.use-case.js";
import { DenyAccountPermissionUseCase } from "../../src/platform/deny-account-permission.use-case.js";
import { FindAccountUseCase } from "../../src/platform/find-account.use-case.js";
import type { PlatformReader } from "../../src/platform/platform.reader.js";
import { ReinstateAccountUseCase } from "../../src/platform/reinstate-account.use-case.js";
import { SuspendAccountUseCase } from "../../src/platform/suspend-account.use-case.js";
import type {
  ActivityLogger,
  CapabilityInvalidator,
  SessionGateway,
  UnitOfWork,
} from "../../src/port/index.js";
import { Authorizer } from "../../src/primitive/authorizer.js";
import { Principal } from "../../src/primitive/principal.js";
import {
  type OverrideInput,
  type PermissionOverrideRecord,
  PermissionOverrideRepository,
} from "../../src/rbac/permission-override.repository.js";

const TIER = Identifiers.organizationId.parse("018f8c00-0000-7000-8000-000000000001");
const ACME = Identifiers.organizationId.parse("018f8c00-0000-7000-8000-000000000010");
const GLOBEX = Identifiers.organizationId.parse("018f8c00-0000-7000-8000-000000000020");
const ADMIN = Identifiers.userId.parse("018f8c00-0000-7000-8000-000000000011");
const SECOND = Identifiers.userId.parse("018f8c00-0000-7000-8000-000000000012");
const TARGET = Identifiers.userId.parse("018f8c00-0000-7000-8000-000000000013");
const NOW = new Date("2026-09-29T00:00:00Z");

const membership = (organizationId: OrganizationId) => ({
  organizationId,
  name: organizationId,
  slug: organizationId,
  roleName: "Member",
  deactivated: false,
});

// Reads the overrides fake the way the real query joins `permission_overrides`: one catalog
// store, so the account's denies and the holder count see the same rows.
class MemoryAccounts extends AccountRepository {
  public readonly accounts = new Map<UserId, Omit<AccountRecord, "denies">>();
  // The tier's role holders of the recovery key, before any suspend or platform deny.
  public holders: UserId[] = [ADMIN, SECOND];

  public constructor(private readonly overrides: MemoryOverrides) {
    super();
    this.put(TARGET, [ACME, GLOBEX]);
    this.put(ADMIN, [TIER]);
    this.put(SECOND, [TIER]);
  }

  public put(userId: UserId, organizations: readonly OrganizationId[]): void {
    this.accounts.set(userId, {
      userId,
      email: `${userId}@example.test`,
      name: "x",
      suspendedAt: null,
      memberships: organizations.map(membership),
    });
  }

  public override findByEmail(email: string) {
    const found = [...this.accounts.values()].find((a) => a.email === email);
    return Promise.resolve(found ? this.withDenies(found) : null);
  }

  public override findById(userId: UserId) {
    const found = this.accounts.get(userId);
    return Promise.resolve(found ? this.withDenies(found) : null);
  }

  public override saveSuspension(userId: UserId, suspendedAt: Date | null): Promise<void> {
    const account = this.accounts.get(userId);
    if (account) this.accounts.set(userId, { ...account, suspendedAt });
    return Promise.resolve();
  }

  public override holdersOf(tier: OrganizationId, permission: string): Promise<readonly UserId[]> {
    const denied = (id: UserId) =>
      this.overrides.rows.some(
        (row) =>
          row.organizationId === tier &&
          row.userId === id &&
          row.authority === "platform" &&
          row.permission === permission,
      );
    return Promise.resolve(
      this.holders.filter((id) => !this.accounts.get(id)?.suspendedAt && !denied(id)),
    );
  }

  private withDenies(account: Omit<AccountRecord, "denies">): AccountRecord {
    const denies = this.overrides.rows
      .filter((row) => row.userId === account.userId && row.authority === "platform")
      .map((row) => ({
        id: row.id,
        organizationId: row.organizationId,
        permission: row.permission,
        reason: row.reason,
        createdAt: row.createdAt,
      }));
    return { ...account, denies };
  }
}

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
      this.rows.push({
        ...row,
        id: `${organizationId}:${row.permission}:${row.authority}`,
        goalId: null,
        organizationId,
        userId,
        createdAt: NOW,
      });
    }
    return Promise.resolve();
  }

  public override delete(_organizationId: OrganizationId, id: string): Promise<void> {
    const at = this.rows.findIndex((row) => row.id === id);
    if (at >= 0) this.rows.splice(at, 1);
    return Promise.resolve();
  }

  public override findExpired() {
    return Promise.resolve([]);
  }
}

function harness(options: { readonly failCommit?: boolean } = {}) {
  const overrides = new MemoryOverrides();
  const accounts = new MemoryAccounts(overrides);
  const flushed: string[] = [];
  const revoked: UserId[] = [];
  const recorded: { organizationId: string; action: string; payload: unknown }[] = [];

  const invalidator = {
    invalidate: (organizationId: OrganizationId, userId: UserId) => {
      flushed.push(`${organizationId}:${userId}`);
      return Promise.resolve();
    },
  } as unknown as CapabilityInvalidator;
  const sessions = {
    revokeAll: (userId: UserId) => {
      revoked.push(userId);
      return Promise.resolve();
    },
  } as SessionGateway;
  const activity: ActivityLogger = {
    record: (actor, action, payload) => {
      recorded.push({ organizationId: actor.organizationId, action, payload });
      return Promise.resolve();
    },
  };
  // A commit that fails after the work ran, which is what a rolled-back transaction is.
  const unitOfWork = {
    run: async <T>(work: () => Promise<T>) => {
      const result = await work();
      if (options.failCommit) throw new Error("rolled back");
      return result;
    },
  } as UnitOfWork;
  const platform = { organizationId: () => Promise.resolve(TIER) } as PlatformReader;
  const authorizer = new Authorizer();

  return {
    accounts,
    overrides,
    flushed,
    revoked,
    recorded,
    find: new FindAccountUseCase(authorizer, accounts),
    suspend: new SuspendAccountUseCase(
      authorizer,
      accounts,
      platform,
      invalidator,
      sessions,
      activity,
      unitOfWork,
      new FixedClock(NOW),
    ),
    reinstate: new ReinstateAccountUseCase(
      authorizer,
      accounts,
      platform,
      invalidator,
      activity,
      unitOfWork,
    ),
    deny: new DenyAccountPermissionUseCase(
      authorizer,
      accounts,
      overrides,
      platform,
      invalidator,
      activity,
      unitOfWork,
    ),
    clear: new ClearAccountDenyUseCase(
      authorizer,
      overrides,
      platform,
      invalidator,
      activity,
      unitOfWork,
    ),
  };
}

const platformAdmin = (userId: UserId, ...grants: readonly PermissionKey[]) =>
  new Principal(
    TIER,
    userId,
    CapabilitySet.from({
      wildcard: false,
      org: { grants: [], denies: [] },
      goals: {},
      platform: { grants, denies: [] },
    }),
  );

const manager = platformAdmin(ADMIN, "platform.account.read", "platform.account.manage");
const reader = platformAdmin(ADMIN, "platform.account.read");

describe("FindAccountUseCase", () => {
  it("finds an account by address, with every tenant it belongs to", async () => {
    const { find } = harness();

    const account = await find.execute(reader, { email: ` ${TARGET}@example.test ` });

    expect(account.userId).toBe(TARGET);
    expect(account.memberships.map((m) => m.organizationId)).toEqual([ACME, GLOBEX]);
  });

  it("answers NOT_FOUND for an unknown address, and FORBIDDEN without the read key", async () => {
    const { find } = harness();

    await expect(find.execute(reader, { email: "nobody@example.test" })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(
      find.execute(platformAdmin(ADMIN), { email: `${TARGET}@example.test` }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("SuspendAccountUseCase", () => {
  it("suspends, audits in the tier and every tenant once, and signs out after the commit", async () => {
    const { suspend, accounts, recorded, flushed, revoked } = harness();

    await suspend.execute(manager, { userId: TARGET, reason: " compromised " });

    expect(accounts.accounts.get(TARGET)?.suspendedAt).toEqual(NOW);
    expect(recorded.map((r) => `${r.organizationId}:${r.action}`)).toEqual([
      `${TIER}:account.suspended`,
      `${ACME}:account.suspended`,
      `${GLOBEX}:account.suspended`,
    ]);
    expect(recorded[0]?.payload).toMatchObject({ userId: TARGET, reason: "compromised" });
    expect(flushed).toEqual([`${TIER}:${TARGET}`, `${ACME}:${TARGET}`, `${GLOBEX}:${TARGET}`]);
    expect(revoked).toEqual([TARGET]);
  });

  // A platform admin belongs to the tier: it is still one audit row there, not two.
  it("audits the tier once for a platform admin", async () => {
    const { suspend, recorded } = harness();

    await suspend.execute(manager, { userId: SECOND, reason: "leaving" });

    expect(recorded.map((r) => r.organizationId)).toEqual([TIER]);
  });

  it("signs nobody out when the commit fails", async () => {
    const { suspend, revoked } = harness({ failCommit: true });

    await expect(suspend.execute(manager, { userId: TARGET, reason: "x" })).rejects.toThrow();
    expect(revoked).toEqual([]);
  });

  it("does nothing to an account already suspended", async () => {
    const { suspend, recorded, revoked } = harness();
    await suspend.execute(manager, { userId: TARGET, reason: "x" });
    recorded.length = 0;
    revoked.length = 0;

    await suspend.execute(manager, { userId: TARGET, reason: "again" });

    expect(recorded).toEqual([]);
    expect(revoked).toEqual([]);
  });

  it("refuses yourself, a missing reason, and an actor without the manage key", async () => {
    const { suspend } = harness();

    await expect(suspend.execute(manager, { userId: ADMIN, reason: "x" })).rejects.toMatchObject({
      code: "CONFLICT",
      context: { reason: "self" },
    });
    await expect(suspend.execute(manager, { userId: TARGET, reason: "  " })).rejects.toBeInstanceOf(
      ValidationError,
    );
    await expect(suspend.execute(reader, { userId: TARGET, reason: "x" })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  // `RV.14`. Two admins suspending each other would leave nobody to reinstate either.
  it("refuses to suspend the last live holder of the recovery key", async () => {
    const { suspend, accounts } = harness();
    accounts.holders = [SECOND];

    await expect(suspend.execute(manager, { userId: SECOND, reason: "x" })).rejects.toMatchObject({
      code: "CONFLICT",
      context: { reason: "last-admin" },
    });
  });

  it("counts a holder the platform denied the recovery key as no holder at all", async () => {
    const { suspend, overrides } = harness();
    await overrides.save(
      TIER,
      ADMIN,
      [
        {
          permission: "platform.account.manage",
          effect: "deny",
          reason: "x",
          expiresAt: null,
          authority: "platform",
        },
      ],
      SECOND,
    );

    await expect(suspend.execute(manager, { userId: SECOND, reason: "x" })).rejects.toBeInstanceOf(
      ConflictError,
    );
  });
});

describe("ReinstateAccountUseCase", () => {
  it("lifts the suspend and audits it everywhere the suspend was", async () => {
    const { suspend, reinstate, accounts, recorded } = harness();
    await suspend.execute(manager, { userId: TARGET, reason: "x" });
    recorded.length = 0;

    await reinstate.execute(manager, { userId: TARGET, reason: "cleared by support" });

    expect(accounts.accounts.get(TARGET)?.suspendedAt).toBeNull();
    expect(recorded.map((r) => `${r.organizationId}:${r.action}`)).toEqual([
      `${TIER}:account.reinstated`,
      `${ACME}:account.reinstated`,
      `${GLOBEX}:account.reinstated`,
    ]);
  });

  it("does nothing to an account that is not suspended", async () => {
    const { reinstate, recorded } = harness();

    await reinstate.execute(manager, { userId: TARGET, reason: "x" });

    expect(recorded).toEqual([]);
  });
});

describe("DenyAccountPermissionUseCase", () => {
  it("writes a platform deny in the tenant, audited there and in the tier", async () => {
    const { deny, overrides, recorded, flushed } = harness();

    const keys = await deny.execute(manager, {
      userId: TARGET,
      organizationId: ACME,
      permission: "analytics.activity.read",
      reason: "abuse",
    });

    expect(keys).toContain("analytics.activity.read");
    expect(overrides.rows.every((row) => row.authority === "platform")).toBe(true);
    expect(overrides.rows.every((row) => row.organizationId === ACME)).toBe(true);
    expect(overrides.rows.every((row) => row.expiresAt === null)).toBe(true);
    expect(recorded.map((r) => `${r.organizationId}:${r.action}`)).toEqual([
      `${ACME}:override.denied`,
      `${TIER}:override.denied`,
    ]);
    expect(recorded[0]?.payload).toMatchObject({ authority: "platform", organizationId: ACME });
    expect(flushed).toEqual([`${ACME}:${TARGET}`]);
  });

  it("refuses a tenant the person does not belong to", async () => {
    const { deny } = harness();

    await expect(
      deny.execute(manager, {
        userId: TARGET,
        organizationId: TIER,
        permission: "analytics.activity.read",
        reason: "x",
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  // A platform key is held only in the tier, and a tenant key never is.
  it("refuses a platform key outside the tier and a tenant key inside it", async () => {
    const { deny, accounts } = harness();
    accounts.put(TARGET, [ACME, TIER]);

    await expect(
      deny.execute(manager, {
        userId: TARGET,
        organizationId: ACME,
        permission: "platform.status.read",
        reason: "x",
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      deny.execute(manager, {
        userId: TARGET,
        organizationId: TIER,
        permission: "analytics.activity.read",
        reason: "x",
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("refuses a core key and yourself", async () => {
    const { deny, accounts } = harness();
    accounts.put(ADMIN, [TIER, ACME]);

    await expect(
      deny.execute(manager, {
        userId: TARGET,
        organizationId: ACME,
        permission: "core.activity.write",
        reason: "x",
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      deny.execute(manager, {
        userId: ADMIN,
        organizationId: ACME,
        permission: "analytics.activity.read",
        reason: "x",
      }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  // The read key closes over the manage key, which requires it — so it is guarded too.
  it("closes a platform deny over what requires it, and guards the last admin", async () => {
    const { deny, accounts } = harness();

    const keys = await deny.execute(manager, {
      userId: SECOND,
      organizationId: TIER,
      permission: "platform.account.read",
      reason: "x",
    });
    expect(keys).toEqual(
      expect.arrayContaining(["platform.account.read", "platform.account.manage"]),
    );

    const fresh = harness();
    fresh.accounts.holders = [SECOND];
    await expect(
      fresh.deny.execute(manager, {
        userId: SECOND,
        organizationId: TIER,
        permission: "platform.account.read",
        reason: "x",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT", context: { reason: "last-admin" } });
    expect(accounts.holders).toEqual([ADMIN, SECOND]);
  });
});

describe("ClearAccountDenyUseCase", () => {
  it("clears the platform's own denies, which the account lists", async () => {
    const { deny, clear, find, overrides } = harness();
    await deny.execute(manager, {
      userId: TARGET,
      organizationId: ACME,
      permission: "analytics.activity.read",
      reason: "x",
    });

    const listed = (await find.execute(reader, { email: `${TARGET}@example.test` })).denies;
    expect(listed.map((row) => row.organizationId)).toContain(ACME);

    for (const row of listed) {
      await clear.execute(manager, { organizationId: row.organizationId, overrideId: row.id });
    }
    expect(overrides.rows).toEqual([]);
  });

  // An org's exception is its admin's to clear; the tier reaching in is a second way.
  it("lists nothing an org wrote, and refuses to clear it", async () => {
    const { clear, find, overrides } = harness();
    await overrides.save(
      ACME,
      TARGET,
      [
        {
          permission: "member.invite",
          effect: "deny",
          reason: null,
          expiresAt: null,
          authority: "org",
        },
      ],
      ADMIN,
    );

    expect((await find.execute(reader, { email: `${TARGET}@example.test` })).denies).toEqual([]);
    await expect(
      clear.execute(manager, { organizationId: ACME, overrideId: `${ACME}:member.invite:org` }),
    ).rejects.toMatchObject({ code: "CONFLICT", context: { reason: "org" } });
  });
});
