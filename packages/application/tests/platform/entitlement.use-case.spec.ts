import { Identifiers, type OrganizationId, type UserId } from "@loadbearing/contracts";
import { FixedClock } from "@loadbearing/core";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@loadbearing/errors";
import { CapabilitySet, EntitlementMask, type PermissionKey } from "@loadbearing/permissions";
import { describe, expect, it } from "vitest";
import { AdjustEntitlementUseCase } from "../../src/platform/adjust-entitlement.use-case.js";
import { AssignPlanUseCase } from "../../src/platform/assign-plan.use-case.js";
import { ClearEntitlementAdjustmentUseCase } from "../../src/platform/clear-entitlement-adjustment.use-case.js";
import { DeletePlanUseCase } from "../../src/platform/delete-plan.use-case.js";
import {
  type AdjustmentInput,
  type AdjustmentRecord,
  EntitlementRepository,
  type ModuleSwitchRecord,
  type PlanInput,
  type PlanRecord,
} from "../../src/platform/entitlement.repository.js";
import { ExpireEntitlementAdjustmentsUseCase } from "../../src/platform/expire-entitlement-adjustments.use-case.js";
import { GetOrganizationEntitlementUseCase } from "../../src/platform/get-organization-entitlement.use-case.js";
import { ListModuleSwitchesUseCase } from "../../src/platform/list-module-switches.use-case.js";
import type { PlatformReader } from "../../src/platform/platform.reader.js";
import { SavePlanUseCase } from "../../src/platform/save-plan.use-case.js";
import type { ShardMapReader, ShardTenant } from "../../src/platform/shard-map.reader.js";
import { SwitchModuleUseCase } from "../../src/platform/switch-module.use-case.js";
import type { ActivityLogger, CapabilityInvalidator, UnitOfWork } from "../../src/port/index.js";
import { Authorizer } from "../../src/primitive/authorizer.js";
import { Principal } from "../../src/primitive/principal.js";
import type { CapabilityRepository } from "../../src/rbac/capability.repository.js";
import type { RoleRepository } from "../../src/rbac/role.repository.js";

const PLATFORM = Identifiers.organizationId.parse("018f8c00-0000-7000-8000-000000000001");
const ACME = Identifiers.organizationId.parse("018f8c00-0000-7000-8000-000000000010");
const ACTOR = Identifiers.userId.parse("018f8c00-0000-7000-8000-000000000011");
const NOW = new Date("2026-09-28T00:00:00Z");

const TENANT: ShardTenant = {
  organizationId: ACME,
  slug: "acme",
  name: "Acme",
  node: 0,
  assignedAt: NOW,
  movedAt: null,
  retentionOverrides: 0,
};

class MemoryEntitlements extends EntitlementRepository {
  public readonly plans = new Map<string, PlanRecord>([
    [
      "unlimited",
      {
        key: "unlimited",
        name: "Unlimited",
        description: "",
        isUnlimited: true,
        isSystem: true,
        permissions: [],
        organizations: 1,
      },
    ],
  ]);
  public defaultPlan = "unlimited";
  public readonly planOf = new Map<OrganizationId, string>([[ACME, "unlimited"]]);
  public readonly adjustments: AdjustmentRecord[] = [];
  public readonly disabled = new Map<string, ModuleSwitchRecord>();

  public override findPlans(): Promise<readonly PlanRecord[]> {
    return Promise.resolve([...this.plans.values()]);
  }

  public override findPlan(key: string): Promise<PlanRecord | null> {
    return Promise.resolve(this.plans.get(key) ?? null);
  }

  public override savePlan(plan: PlanInput): Promise<void> {
    this.plans.set(plan.key, {
      ...plan,
      isUnlimited: false,
      isSystem: false,
      organizations: [...this.planOf.values()].filter((key) => key === plan.key).length,
    });
    return Promise.resolve();
  }

  public override deletePlan(key: string): Promise<void> {
    this.plans.delete(key);
    return Promise.resolve();
  }

  public override findDefaultPlan(): Promise<string> {
    return Promise.resolve(this.defaultPlan);
  }

  public override saveDefaultPlan(key: string): Promise<void> {
    this.defaultPlan = key;
    return Promise.resolve();
  }

  public override findPlanOf(organizationId: OrganizationId): Promise<string | null> {
    return Promise.resolve(this.planOf.get(organizationId) ?? null);
  }

  public override savePlanOf(organizationId: OrganizationId, planKey: string): Promise<void> {
    this.planOf.set(organizationId, planKey);
    return Promise.resolve();
  }

  public override findAdjustments(
    organizationId: OrganizationId,
  ): Promise<readonly AdjustmentRecord[]> {
    return Promise.resolve(this.adjustments.filter((row) => row.organizationId === organizationId));
  }

  public override saveAdjustments(
    organizationId: OrganizationId,
    rows: readonly AdjustmentInput[],
    _actor: UserId,
  ): Promise<void> {
    for (const row of rows) {
      const at = this.adjustments.findIndex(
        (existing) =>
          existing.organizationId === organizationId && existing.permission === row.permission,
      );
      const record = { ...row, organizationId, createdAt: NOW };
      if (at >= 0) this.adjustments[at] = record;
      else this.adjustments.push(record);
    }
    return Promise.resolve();
  }

  public override deleteAdjustment(
    organizationId: OrganizationId,
    permission: string,
  ): Promise<boolean> {
    const at = this.adjustments.findIndex(
      (row) => row.organizationId === organizationId && row.permission === permission,
    );
    if (at < 0) return Promise.resolve(false);
    this.adjustments.splice(at, 1);
    return Promise.resolve(true);
  }

  public override findExpired(now: Date): Promise<readonly AdjustmentRecord[]> {
    return Promise.resolve(
      this.adjustments.filter((row) => row.expiresAt !== null && row.expiresAt <= now),
    );
  }

  public override findDisabledModules(): Promise<readonly ModuleSwitchRecord[]> {
    return Promise.resolve([...this.disabled.values()]);
  }

  public override saveDisabledModule(module: string, reason: string): Promise<void> {
    this.disabled.set(module, { module, reason, disabledAt: NOW });
    return Promise.resolve();
  }

  public override deleteDisabledModule(module: string): Promise<void> {
    this.disabled.delete(module);
    return Promise.resolve();
  }
}

class RecordingInvalidator implements CapabilityInvalidator {
  public readonly flushed: string[] = [];

  public invalidate(): Promise<void> {
    throw new Error("an entitlement change flushes an org or everyone, never one member");
  }

  public invalidateOrganization(organizationId: OrganizationId): Promise<void> {
    this.flushed.push(organizationId);
    return Promise.resolve();
  }

  public invalidatePlatform(): Promise<void> {
    throw new Error("no plan reaches the platform axis");
  }

  public invalidateAll(): Promise<void> {
    this.flushed.push("*");
    return Promise.resolve();
  }
}

function harness() {
  const entitlements = new MemoryEntitlements();
  const invalidator = new RecordingInvalidator();
  const recorded: { organizationId: string; action: string; payload: unknown }[] = [];
  const activity: ActivityLogger = {
    record: (actor, action, payload) => {
      recorded.push({ organizationId: actor.organizationId, action, payload });
      return Promise.resolve();
    },
  };
  const unitOfWork = { run: <T>(work: () => Promise<T>) => work() } as UnitOfWork;
  const platform = { organizationId: () => Promise.resolve(PLATFORM) } as PlatformReader;
  const tenants = {
    findByTerm: (term: string) => Promise.resolve(term === "acme" || term === ACME ? TENANT : null),
  } as ShardMapReader;
  const authorizer = new Authorizer();
  const shared = [entitlements, invalidator, tenants, platform, activity, unitOfWork] as const;

  return {
    entitlements,
    invalidator,
    recorded,
    savePlan: new SavePlanUseCase(
      authorizer,
      entitlements,
      invalidator,
      platform,
      activity,
      unitOfWork,
    ),
    deletePlan: new DeletePlanUseCase(
      authorizer,
      entitlements,
      invalidator,
      platform,
      activity,
      unitOfWork,
    ),
    assign: new AssignPlanUseCase(authorizer, ...shared),
    adjust: new AdjustEntitlementUseCase(authorizer, ...shared, new FixedClock(NOW)),
    clear: new ClearEntitlementAdjustmentUseCase(authorizer, ...shared),
    expire: new ExpireEntitlementAdjustmentsUseCase(
      entitlements,
      invalidator,
      platform,
      activity,
      unitOfWork,
    ),
    listSwitches: new ListModuleSwitchesUseCase(authorizer, entitlements),
    switchModule: new SwitchModuleUseCase(
      authorizer,
      entitlements,
      invalidator,
      platform,
      activity,
      unitOfWork,
    ),
  };
}

const actor = (...platform: readonly PermissionKey[]) =>
  new Principal(
    ACME,
    ACTOR,
    CapabilitySet.from({
      wildcard: false,
      org: { grants: [], denies: [] },
      goals: {},
      platform: { grants: platform, denies: [] },
    }),
  );

const admin = actor(
  "platform.entitlement.read",
  "platform.entitlement.manage",
  "platform.module.manage",
  "platform.status.read",
);

describe("SavePlanUseCase", () => {
  it("stores the plan closed over requires, audits in the tier, and flushes every tenant", async () => {
    const { savePlan, entitlements, recorded, invalidator } = harness();

    await savePlan.execute(admin, {
      key: "team",
      name: " Team ",
      description: "",
      permissions: ["member.invite"],
    });

    expect(entitlements.plans.get("team")).toMatchObject({
      name: "Team",
      permissions: ["member.invite", "member.read", "rbac.role.read"],
    });
    expect(recorded.map((entry) => [entry.organizationId, entry.action])).toEqual([
      [PLATFORM, "plan.saved"],
    ]);
    expect(invalidator.flushed).toEqual(["*"]);
  });

  it("refuses to edit a system plan, and a key no plan may hold", async () => {
    const { savePlan } = harness();
    const plan = { name: "x", description: "", permissions: [] };

    await expect(savePlan.execute(admin, { ...plan, key: "unlimited" })).rejects.toBeInstanceOf(
      ConflictError,
    );
    await expect(
      savePlan.execute(admin, { ...plan, key: "team", permissions: ["platform.status.read"] }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("refuses a caller who may only read plans", async () => {
    const { savePlan } = harness();

    await expect(
      savePlan.execute(actor("platform.entitlement.read"), {
        key: "team",
        name: "Team",
        description: "",
        permissions: [],
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("DeletePlanUseCase", () => {
  it("refuses a system plan, a plan in use, and the default plan", async () => {
    const { deletePlan, savePlan, entitlements, assign } = harness();
    const team = { key: "team", name: "Team", description: "", permissions: [] };
    await savePlan.execute(admin, team);

    await expect(deletePlan.execute(admin, { key: "unlimited" })).rejects.toBeInstanceOf(
      ConflictError,
    );

    entitlements.defaultPlan = "team";
    await expect(deletePlan.execute(admin, { key: "team" })).rejects.toBeInstanceOf(ConflictError);
    entitlements.defaultPlan = "unlimited";

    await assign.execute(admin, { organization: "acme", planKey: "team" });
    await savePlan.execute(admin, team);
    await expect(deletePlan.execute(admin, { key: "team" })).rejects.toBeInstanceOf(ConflictError);
  });

  it("deletes an unused plan", async () => {
    const { deletePlan, savePlan, entitlements } = harness();
    await savePlan.execute(admin, {
      key: "spare",
      name: "Spare",
      description: "",
      permissions: [],
    });

    await deletePlan.execute(admin, { key: "spare" });

    expect(entitlements.plans.has("spare")).toBe(false);
  });
});

describe("AssignPlanUseCase", () => {
  it("moves an org by slug, flushes only that org, and is a no-op when nothing changes", async () => {
    const { assign, savePlan, entitlements, invalidator, recorded } = harness();
    await savePlan.execute(admin, { key: "team", name: "Team", description: "", permissions: [] });
    invalidator.flushed.length = 0;
    recorded.length = 0;

    await assign.execute(admin, { organization: "acme", planKey: "team" });
    await assign.execute(admin, { organization: "acme", planKey: "team" });

    expect(entitlements.planOf.get(ACME)).toBe("team");
    expect(invalidator.flushed).toEqual([ACME]);
    // Once in the tier and once in the org it moved, and nothing for the no-op.
    expect(recorded.map((entry) => [entry.organizationId, entry.action])).toEqual([
      [PLATFORM, "organization.plan.changed"],
      [ACME, "organization.plan.changed"],
    ]);
  });

  it("answers NOT_FOUND for an unknown org or plan", async () => {
    const { assign } = harness();

    await expect(
      assign.execute(admin, { organization: "nobody", planKey: "unlimited" }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      assign.execute(admin, { organization: "acme", planKey: "no-such" }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("AdjustEntitlementUseCase", () => {
  // `RV.13` both ways, each key carrying the same reason and expiry.
  it("closes an add over what it needs and a remove over what depends on it", async () => {
    const { adjust, entitlements } = harness();
    const trialEnds = new Date(NOW.getTime() + 60_000);

    await adjust.execute(admin, {
      organization: "acme",
      permission: "member.invite",
      effect: "add",
      reason: "trial",
      expiresAt: trialEnds,
    });
    expect(entitlements.adjustments.map((row) => row.permission).sort()).toEqual([
      "member.invite",
      "member.read",
      "rbac.role.read",
    ]);
    expect(entitlements.adjustments.every((row) => row.expiresAt === trialEnds)).toBe(true);

    const removed = await adjust.execute(admin, {
      organization: "acme",
      permission: "rbac.role.read",
      effect: "remove",
      reason: "downgrade",
      expiresAt: null,
    });
    expect(removed).toContain("member.invite");
    expect(entitlements.adjustments.find((row) => row.permission === "member.invite")?.effect).toBe(
      "remove",
    );
  });

  it("refuses a past expiry, a missing reason, and a key outside the mask", async () => {
    const { adjust } = harness();
    const base = { organization: "acme", effect: "add" as const, expiresAt: null };

    await expect(
      adjust.execute(admin, {
        ...base,
        permission: "member.read",
        reason: "x",
        expiresAt: new Date(NOW.getTime() - 1),
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      adjust.execute(admin, { ...base, permission: "member.read", reason: " " }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      adjust.execute(admin, { ...base, permission: "core.activity.write", reason: "x" }),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("ClearEntitlementAdjustmentUseCase", () => {
  it("clears one key and flushes the org, and a retry changes nothing", async () => {
    const { adjust, clear, entitlements, invalidator } = harness();
    await adjust.execute(admin, {
      organization: "acme",
      permission: "member.read",
      effect: "remove",
      reason: "x",
      expiresAt: null,
    });
    invalidator.flushed.length = 0;

    await clear.execute(admin, { organization: "acme", permission: "member.read" });
    await clear.execute(admin, { organization: "acme", permission: "member.read" });

    expect(entitlements.adjustments.some((row) => row.permission === "member.read")).toBe(false);
    expect(invalidator.flushed).toEqual([ACME]);
  });
});

describe("ExpireEntitlementAdjustmentsUseCase", () => {
  it("removes, audits and flushes each expired row, and leaves a live one", async () => {
    const { expire, entitlements, invalidator, recorded } = harness();
    entitlements.adjustments.push(
      {
        organizationId: ACME,
        permission: "analytics.activity.read",
        effect: "add",
        reason: "trial",
        expiresAt: new Date(NOW.getTime() - 1),
        createdAt: NOW,
      },
      {
        organizationId: ACME,
        permission: "member.read",
        effect: "add",
        reason: "trial",
        expiresAt: new Date(NOW.getTime() + 60_000),
        createdAt: NOW,
      },
    );

    const outcome = await expire.execute(actor(), NOW);

    expect(outcome).toEqual({ adjustments: 1 });
    expect(entitlements.adjustments.map((row) => row.permission)).toEqual(["member.read"]);
    expect(recorded.map((entry) => [entry.organizationId, entry.action])).toEqual([
      [PLATFORM, "entitlement.adjustment.expired"],
      [ACME, "entitlement.adjustment.expired"],
    ]);
    expect(invalidator.flushed).toEqual([ACME]);
  });

  it("does nothing, and flushes nothing, when nothing has expired", async () => {
    const { expire, invalidator } = harness();

    expect(await expire.execute(actor(), NOW)).toEqual({ adjustments: 0 });
    expect(invalidator.flushed).toEqual([]);
  });
});

describe("the module kill switch", () => {
  it("switches a module off with a reason, lists it, and flushes every tenant", async () => {
    const { switchModule, listSwitches, invalidator } = harness();

    await switchModule.execute(admin, { module: "messaging", enabled: false, reason: "incident" });

    const messaging = (await listSwitches.execute(admin)).find((row) => row.module === "messaging");
    expect(messaging).toMatchObject({ enabled: false, reason: "incident" });
    expect(invalidator.flushed).toEqual(["*"]);

    await switchModule.execute(admin, { module: "messaging", enabled: true, reason: "" });
    expect(
      (await listSwitches.execute(admin)).find((row) => row.module === "messaging")?.enabled,
    ).toBe(true);
  });

  it("refuses core and platform, and a switch-off with no reason", async () => {
    const { switchModule } = harness();

    for (const module of ["core", "platform"]) {
      await expect(
        switchModule.execute(admin, { module, enabled: false, reason: "x" }),
      ).rejects.toBeInstanceOf(ValidationError);
    }
    await expect(
      switchModule.execute(admin, { module: "messaging", enabled: false, reason: "" }),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("GetOrganizationEntitlementUseCase", () => {
  it("reports the entitled keys and how much of each role the plan lets through", async () => {
    const { entitlements } = harness();
    const mask = EntitlementMask.from({
      plan: ["member.read", "rbac.role.read"],
      added: [],
      removed: [],
      disabledModules: [],
    });
    const capabilities = {
      entitlementFor: () => Promise.resolve(mask),
    } as unknown as CapabilityRepository;
    const roles = {
      list: () =>
        Promise.resolve({
          total: 1,
          items: [
            {
              id: "r",
              key: "accountant",
              name: "Accountant",
              description: null,
              scope: "org",
              isSystem: false,
              permissions: ["member.read", "analytics.activity.read", "core.activity.write"],
            },
          ],
        }),
    } as unknown as RoleRepository;
    const tenants = { findByTerm: () => Promise.resolve(TENANT) } as unknown as ShardMapReader;

    const result = await new GetOrganizationEntitlementUseCase(
      new Authorizer(),
      entitlements,
      capabilities,
      roles,
      tenants,
    ).execute(admin, { organization: "acme" });

    expect(result.organization.slug).toBe("acme");
    expect(result.planKey).toBe("unlimited");
    expect([...result.entitled].sort()).toEqual(["member.read", "rbac.role.read"]);
    expect(result.roles).toEqual([
      { key: "accountant", name: "Accountant", listed: 2, entitled: 1 },
    ]);
  });
});
