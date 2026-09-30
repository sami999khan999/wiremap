import { describe, expect, it } from "vitest";
import { CapabilitySet } from "../../src/capability/capability-set.js";
import { GATES } from "../../src/gate/index.js";
import { ModuleRegistry } from "../../src/registry/module-registry.js";
import { PermissionRegistry } from "../../src/registry/permission-registry.js";

const registry = ModuleRegistry.instance;

describe("ModuleRegistry", () => {
  it("maps a module key to its gate", () => {
    expect(registry.gate("rbac")).toEqual({
      permission: "rbac.role.read",
      route: "/settings/roles",
    });
  });

  it("hides every module from an empty capability set", () => {
    expect(registry.visibleModules(CapabilitySet.empty())).toEqual([]);
  });

  it("shows only the modules whose gating permission is held", () => {
    const caps = CapabilitySet.from({
      wildcard: false,
      org: { grants: ["member.read"], denies: [] },
      goals: {},
    });

    expect(registry.isVisible("member", caps)).toBe(true);
    expect(registry.isVisible("rbac", caps)).toBe(false);
    expect(registry.visibleModules(caps)).toEqual(["member"]);
  });

  it("hides a module a wildcard holder has been explicitly denied", () => {
    const caps = CapabilitySet.from({
      wildcard: true,
      org: { grants: [], denies: ["rbac.role.read"] },
      goals: {},
    });

    // Everything but the denied one, in `GATES` order — a wildcard is not a licence to
    // ignore a deny.
    expect(registry.visibleModules(caps)).toEqual([
      "member",
      "apikey",
      "document",
      "notification",
      "analytics",
      "doc",
    ]);
  });

  // `visibleModules()` asks without a `goalId`, so a module gated on a goal-scoped key
  // is invisible to everyone forever. `platform` is fine: `can()` answers it without one.
  it("gates no module on a goal-scoped permission", () => {
    for (const [module, gate] of Object.entries(GATES)) {
      expect(PermissionRegistry.instance.scopeOf(gate.permission), module).not.toBe("goal");
    }
  });

  // The nav is the first surface a leak shows on, and the wildcard case above already
  // proves it — this names why, so a future edit to that list cannot quietly drop it.
  it("hides the platform module from a tenant wildcard and shows it to a holder", () => {
    const owner = CapabilitySet.from({
      wildcard: true,
      org: { grants: [], denies: [] },
      goals: {},
    });
    expect(registry.isVisible("platform", owner)).toBe(false);

    const admin = CapabilitySet.from({
      wildcard: false,
      org: { grants: [], denies: [] },
      goals: {},
      platform: { grants: ["platform.status.read"], denies: [] },
    });
    expect(registry.isVisible("platform", admin)).toBe(true);
  });
});
