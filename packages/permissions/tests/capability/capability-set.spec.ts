import { afterEach, describe, expect, it, vi } from "vitest";
import { CapabilitySet } from "../../src/capability/capability-set.js";
import { type PermissionKey, PermissionRegistry } from "../../src/registry/permission-registry.js";

const GOAL = "018f8c00-0000-7000-8000-000000000001";
const OTHER_GOAL = "018f8c00-0000-7000-8000-000000000002";

// Every shipped key is org-scoped, so the goal-scoped branch of `can()` is unreachable
// through the catalog. Stubbing `scopeOf` tests it now rather than never.
const treatEveryKeyAsGoalScoped = (): void => {
  vi.spyOn(PermissionRegistry.instance, "scopeOf").mockReturnValue("goal");
};

describe("CapabilitySet", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("denies by default", () => {
    expect(CapabilitySet.empty().can("rbac.role.read")).toBe(false);
  });

  // The fifth rule. `core.activity.write` was asserted by one use-case and deliberately
  // not by the others, so whether an audit row could be written depended on the caller.
  it("holds every core permission without a grant", () => {
    expect(CapabilitySet.empty().can("core.activity.write")).toBe(true);
  });

  // Deny still wins, because rule 2 is the one rule nothing is above.
  it("lets an explicit deny beat the core exemption", () => {
    const caps = CapabilitySet.from({
      wildcard: false,
      org: { grants: [], denies: ["core.activity.write"] },
      goals: {},
    });

    expect(caps.can("core.activity.write")).toBe(false);
  });

  // `intersect()` unions denies and intersects grants, and the exemption is neither: it
  // survives a narrowing that names it on no side.
  it("survives a narrowing that names it on neither side", () => {
    const wide = CapabilitySet.from({
      wildcard: true,
      org: { grants: [], denies: [] },
      goals: {},
    });
    const narrow = CapabilitySet.from({
      wildcard: false,
      org: { grants: ["rbac.role.read"], denies: [] },
      goals: {},
    });

    expect(wide.intersect(narrow).can("core.activity.write")).toBe(true);
  });

  it("grants an org-scoped permission under the wildcard", () => {
    const caps = CapabilitySet.from({
      wildcard: true,
      org: { grants: [], denies: [] },
      goals: {},
    });

    expect(caps.can("rbac.role.read")).toBe(true);
  });

  it("denies a goal-scoped permission asked without a goalId", () => {
    treatEveryKeyAsGoalScoped();
    const caps = CapabilitySet.from({
      wildcard: true,
      org: { grants: ["rbac.role.read"], denies: [] },
      goals: { [GOAL]: { grants: ["rbac.role.read"], denies: [] } },
    });

    expect(caps.can("rbac.role.read")).toBe(false);
    expect(caps.can("rbac.role.read", GOAL)).toBe(true);
  });

  it("lets an explicit deny beat the wildcard", () => {
    const caps = CapabilitySet.from({
      wildcard: true,
      org: { grants: [], denies: ["rbac.role.manage"] },
      goals: {},
    });

    expect(caps.can("rbac.role.manage")).toBe(false);
    expect(caps.can("rbac.role.read")).toBe(true);
  });

  // The likeliest real configuration: a role grants the permission and a per-user
  // override denies it. Suspension has to work without unpicking role assignments.
  it("denies a permission that is granted and denied at the same scope", () => {
    const caps = CapabilitySet.from({
      wildcard: false,
      org: { grants: ["member.read", "apikey.read"], denies: ["member.read"] },
      goals: {},
    });

    expect(caps.can("member.read")).toBe(false);
    expect(caps.can("apikey.read")).toBe(true);
  });

  it("lets a goal-level deny beat an org-level grant", () => {
    treatEveryKeyAsGoalScoped();
    const caps = CapabilitySet.from({
      wildcard: false,
      org: { grants: ["member.deactivate"], denies: [] },
      goals: { [GOAL]: { grants: [], denies: ["member.deactivate"] } },
    });

    expect(caps.can("member.deactivate", GOAL)).toBe(false);
    expect(caps.can("member.deactivate", OTHER_GOAL)).toBe(true);
  });

  it("resolves canAll and canAny independently", () => {
    const caps = CapabilitySet.from({
      wildcard: false,
      org: { grants: ["member.read"], denies: [] },
      goals: {},
    });

    expect(caps.canAll(["member.read", "member.invite"])).toBe(false);
    expect(caps.canAny(["member.read", "member.invite"])).toBe(true);
  });

  it("lists only the goals in which a goal-scoped permission holds", () => {
    treatEveryKeyAsGoalScoped();
    const caps = CapabilitySet.from({
      wildcard: false,
      org: { grants: [], denies: [] },
      goals: {
        [GOAL]: { grants: ["member.read"], denies: [] },
        [OTHER_GOAL]: { grants: [], denies: [] },
      },
    });

    expect(caps.goalsWith("member.read", [GOAL, OTHER_GOAL])).toEqual([GOAL]);
  });

  // The two shapes holding a goal-scoped permission in goals their DTO never names.
  // Both answered `[]` before the candidate set became a parameter.
  it("resolves every candidate goal for a wildcard holder", () => {
    treatEveryKeyAsGoalScoped();
    const caps = CapabilitySet.from({
      wildcard: true,
      org: { grants: [], denies: [] },
      goals: {},
    });

    expect(caps.goalsWith("member.read", [GOAL, OTHER_GOAL])).toEqual([GOAL, OTHER_GOAL]);
  });

  it("resolves every candidate goal for an org-level grant of a goal-scoped permission", () => {
    treatEveryKeyAsGoalScoped();
    const caps = CapabilitySet.from({
      wildcard: false,
      org: { grants: ["member.read"], denies: [] },
      goals: {},
    });

    expect(caps.goalsWith("member.read", [GOAL, OTHER_GOAL])).toEqual([GOAL, OTHER_GOAL]);
  });

  it("excludes a goal the wildcard holder is denied inside", () => {
    treatEveryKeyAsGoalScoped();
    const caps = CapabilitySet.from({
      wildcard: true,
      org: { grants: [], denies: [] },
      goals: { [OTHER_GOAL]: { grants: [], denies: ["member.read"] } },
    });

    expect(caps.goalsWith("member.read", [GOAL, OTHER_GOAL])).toEqual([GOAL]);
  });

  it("does not repeat a goal the caller listed twice", () => {
    treatEveryKeyAsGoalScoped();
    const caps = CapabilitySet.from({
      wildcard: true,
      org: { grants: [], denies: [] },
      goals: {},
    });

    expect(caps.goalsWith("member.read", [GOAL, GOAL])).toEqual([GOAL]);
  });

  it("round-trips through JSON", () => {
    const caps = CapabilitySet.from({
      wildcard: false,
      org: { grants: ["member.read"], denies: [] },
      goals: { [GOAL]: { grants: [], denies: [] } },
    });
    const revived = CapabilitySet.from(
      JSON.parse(JSON.stringify(caps.toJSON())) as ReturnType<typeof caps.toJSON>,
    );

    expect(revived.can("member.read")).toBe(true);
  });
});

// An undefined key cannot arrive through the type system but can at runtime: from a
// cast, or a cached DTO that outlived the permission it names.
describe("CapabilitySet and unrecognised permissions", () => {
  const GONE = "task.archive" as PermissionKey;

  it("denies an unrecognised permission rather than throwing", () => {
    const caps = CapabilitySet.from({
      wildcard: true,
      org: { grants: [], denies: [] },
      goals: {},
    });

    expect(() => caps.can(GONE)).not.toThrow();
    expect(caps.can(GONE)).toBe(false);
  });

  it("denies an unrecognised permission through canAll and canAny", () => {
    const caps = CapabilitySet.from({
      wildcard: false,
      org: { grants: ["member.read"], denies: [] },
      goals: {},
    });

    expect(caps.canAll(["member.read", GONE])).toBe(false);
    expect(caps.canAny([GONE])).toBe(false);
    expect(caps.canAny(["member.read", GONE])).toBe(true);
  });

  it("drops unrecognised keys from every set on the way in", () => {
    const caps = CapabilitySet.from({
      wildcard: false,
      org: { grants: ["member.read", GONE], denies: [GONE] },
      goals: { [GOAL]: { grants: [GONE], denies: ["member.read", GONE] } },
    });
    const dto = caps.toJSON();

    expect(dto.org.grants).toEqual(["member.read"]);
    expect(dto.org.denies).toEqual([]);
    expect(dto.goals[GOAL]?.grants).toEqual([]);
    expect(dto.goals[GOAL]?.denies).toEqual(["member.read"]);
  });

  // `toJSON()` hands back the stored DTO, so sanitising the copy rather than the
  // stored object would write the dropped keys straight back out to the cache.
  it("keeps the goal key when every permission inside it was dropped", () => {
    const caps = CapabilitySet.from({
      wildcard: false,
      org: { grants: [], denies: [] },
      goals: { [GOAL]: { grants: [GONE], denies: [] } },
    });

    expect(Object.keys(caps.toJSON().goals)).toEqual([GOAL]);
  });
});

describe("CapabilitySet.intersect", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps only what both sides grant", () => {
    const key = CapabilitySet.from({
      wildcard: false,
      org: { grants: ["member.read", "member.invite"], denies: [] },
      goals: {},
    });
    const issuer = CapabilitySet.from({
      wildcard: false,
      org: { grants: ["member.read"], denies: [] },
      goals: {},
    });
    const narrowed = key.intersect(issuer);

    expect(narrowed.can("member.read")).toBe(true);
    expect(narrowed.can("member.invite")).toBe(false);
  });

  it("honours the other side's org deny even when both hold the wildcard", () => {
    const key = CapabilitySet.from({
      wildcard: true,
      org: { grants: [], denies: [] },
      goals: {},
    });
    const issuer = CapabilitySet.from({
      wildcard: true,
      org: { grants: [], denies: ["rbac.role.manage"] },
      goals: {},
    });
    const narrowed = key.intersect(issuer);

    expect(narrowed.can("rbac.role.manage")).toBe(false);
    expect(narrowed.can("rbac.role.read")).toBe(true);
  });

  it("honours a deny inside a goal the narrowed side has never heard of", () => {
    treatEveryKeyAsGoalScoped();
    const key = CapabilitySet.from({
      wildcard: true,
      org: { grants: [], denies: [] },
      goals: {},
    });
    const issuer = CapabilitySet.from({
      wildcard: true,
      org: { grants: [], denies: [] },
      goals: { [GOAL]: { grants: [], denies: ["member.deactivate"] } },
    });
    const narrowed = key.intersect(issuer);

    expect(narrowed.can("member.deactivate", GOAL)).toBe(false);
    expect(narrowed.can("member.deactivate", OTHER_GOAL)).toBe(true);
  });

  it("keeps an org-level grant of a goal-scoped permission", () => {
    treatEveryKeyAsGoalScoped();
    const caps = CapabilitySet.from({
      wildcard: false,
      org: { grants: ["member.read"], denies: [] },
      goals: { [GOAL]: { grants: [], denies: [] } },
    });

    expect(caps.can("member.read", GOAL)).toBe(true);
    expect(caps.intersect(caps).can("member.read", GOAL)).toBe(true);
  });

  it("drops the wildcard but keeps what the weaker side still grants", () => {
    const key = CapabilitySet.from({
      wildcard: true,
      org: { grants: [], denies: [] },
      goals: {},
    });
    const issuer = CapabilitySet.from({
      wildcard: false,
      org: { grants: ["member.read"], denies: [] },
      goals: {},
    });

    // A wildcard key whose issuer lost superuser narrows to the issuer's grants.
    expect(key.intersect(issuer).can("member.read")).toBe(true);
    expect(key.intersect(issuer).can("member.invite")).toBe(false);
  });

  it("gives the same answers whichever side is narrowed", () => {
    const a = CapabilitySet.from({
      wildcard: true,
      org: { grants: ["member.read"], denies: ["member.invite"] },
      goals: {},
    });
    const b = CapabilitySet.from({
      wildcard: false,
      org: { grants: ["member.read", "member.invite"], denies: [] },
      goals: {},
    });

    for (const p of ["member.read", "member.invite", "apikey.manage"] as const) {
      expect(a.intersect(b).can(p)).toBe(b.intersect(a).can(p));
    }
    expect(a.intersect(b).can("member.read")).toBe(true);
    expect(a.intersect(b).can("member.invite")).toBe(false);
  });
});

// Decision D31: four things would each leak a platform key, and each is a case here that
// fails the moment the `scope === "platform"` branch is removed from `can()`.
describe("CapabilitySet — the platform axis", () => {
  const PLATFORM: PermissionKey = "platform.status.read";

  it("denies a platform key nothing granted", () => {
    expect(CapabilitySet.empty().can(PLATFORM)).toBe(false);
  });

  // Leak 1. A tenant owner holds `wildcard`, and a wildcard that reached the third axis
  // would make every owner of every customer tenant a platform admin.
  it("does not let a tenant wildcard reach it", () => {
    const caps = CapabilitySet.from({
      wildcard: true,
      org: { grants: [], denies: [] },
      goals: {},
    });

    expect(caps.can(PLATFORM)).toBe(false);
    expect(caps.can("rbac.role.read")).toBe(true);
  });

  // Leak 2. An org-level grant of the same key — which a tenant role could carry if the
  // grant use-case were ever bypassed — is not the platform set and must not read as it.
  it("does not accept an org grant in place of a platform grant", () => {
    const caps = CapabilitySet.from({
      wildcard: false,
      org: { grants: [PLATFORM], denies: [] },
      goals: {},
    });

    expect(caps.can(PLATFORM)).toBe(false);
  });

  it("grants a platform key the platform set holds, and honours its deny", () => {
    const granted = CapabilitySet.from({
      wildcard: false,
      org: { grants: [], denies: [] },
      goals: {},
      platform: { grants: [PLATFORM], denies: [] },
    });
    expect(granted.can(PLATFORM)).toBe(true);

    const denied = CapabilitySet.from({
      wildcard: false,
      org: { grants: [], denies: [] },
      goals: {},
      platform: { grants: [PLATFORM], denies: [PLATFORM] },
    });
    expect(denied.can(PLATFORM)).toBe(false);
  });

  // Leak 3. An API key is issued by a user who may be a platform admin. A key that could
  // act as one is a platform admin nobody can revoke by removing a membership.
  it("empties the axis when a key intersects its issuer", () => {
    const issuer = CapabilitySet.from({
      wildcard: false,
      org: { grants: ["rbac.role.read"], denies: [] },
      goals: {},
      platform: { grants: [PLATFORM], denies: [] },
    });
    const key = CapabilitySet.from({
      wildcard: false,
      org: { grants: ["rbac.role.read"], denies: [] },
      goals: {},
      platform: { grants: [PLATFORM], denies: [] },
    });

    const intersected = issuer.intersect(key);
    expect(intersected.can(PLATFORM)).toBe(false);
    expect(intersected.can("rbac.role.read")).toBe(true);
  });

  // Leak 4. The `core` exception grants without a role. A platform key in a core module
  // would be held by every principal in the system, resolved or not.
  it("does not consult the core exception", () => {
    vi.spyOn(PermissionRegistry.instance, "meta").mockReturnValue({
      scope: "platform",
      module: "core",
      label: "core-looking platform key",
    });

    expect(CapabilitySet.empty().can(PLATFORM)).toBe(false);
  });

  // A DTO cached before the axis existed comes back without it. Degrading to "no
  // platform rights" is the safe reading; throwing would 500 every request behind it.
  it("reads a DTO with no platform axis as holding none", () => {
    const caps = CapabilitySet.from({
      wildcard: true,
      org: { grants: [], denies: [] },
      goals: {},
    });

    expect(caps.can(PLATFORM)).toBe(false);
    expect(caps.toJSON().platform).toEqual({ grants: [], denies: [] });
  });
});

// What a role hands out is judged at the org level, since a role is never assigned inside
// one goal. `can()` without a goal answers `false` for a goal key, which is the wrong question.
describe("CapabilitySet.canTenantWide", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("holds a goal-scoped key granted at the org level", () => {
    treatEveryKeyAsGoalScoped();
    const caps = CapabilitySet.from({
      wildcard: false,
      org: { grants: ["rbac.role.read"], denies: [] },
      goals: {},
    });

    expect(caps.can("rbac.role.read")).toBe(false);
    expect(caps.canTenantWide("rbac.role.read")).toBe(true);
  });

  it("does not count a grant inside one goal as tenant-wide", () => {
    treatEveryKeyAsGoalScoped();
    const caps = CapabilitySet.from({
      wildcard: false,
      org: { grants: [], denies: [] },
      goals: { [GOAL]: { grants: ["rbac.role.read"], denies: [] } },
    });

    expect(caps.canTenantWide("rbac.role.read")).toBe(false);
  });

  it("lets an org deny beat the wildcard", () => {
    const caps = CapabilitySet.from({
      wildcard: true,
      org: { grants: [], denies: ["rbac.role.read"] },
      goals: {},
    });

    expect(caps.canTenantWide("rbac.role.read")).toBe(false);
    expect(caps.canTenantWide("rbac.role.manage")).toBe(true);
  });
});
