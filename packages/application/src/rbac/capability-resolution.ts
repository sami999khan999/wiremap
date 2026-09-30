import {
  CapabilitySet,
  type PermissionKey,
  PermissionRegistry,
  type ScopedSetDto,
} from "../import.js";
import type { CapabilityExplanation } from "./capability.repository.js";

interface MutableScoped {
  grants: Set<PermissionKey>;
  denies: Set<PermissionKey>;
}

// Explanation in, answer out. One fold, here, so the inspector's "why" and the gate's
// answer are the same computation: the adapter's `resolveFor` calls exactly this.
export class CapabilityResolution {
  private constructor() {}

  // Deny beats grant; every raw string passes `isKnown` before it is trusted; the plan's
  // mask filters grants last and never touches a deny.
  public static fold(explanation: CapabilityExplanation): CapabilitySet {
    const registry = PermissionRegistry.instance;
    const org: MutableScoped = { grants: new Set(), denies: new Set() };
    const goals = new Map<string, MutableScoped>();
    const scopedFor = (goalId: string): MutableScoped => {
      const existing = goals.get(goalId);
      if (existing) return existing;
      const created: MutableScoped = { grants: new Set(), denies: new Set() };
      goals.set(goalId, created);
      return created;
    };

    for (const permission of explanation.roleGrants) {
      if (registry.isKnown(permission)) org.grants.add(permission);
    }
    for (const [goalId, permissions] of Object.entries(explanation.goalGrants)) {
      for (const permission of permissions) {
        if (registry.isKnown(permission)) scopedFor(goalId).grants.add(permission);
      }
    }
    for (const row of explanation.overrides) {
      if (!registry.isKnown(row.permission)) continue;
      const target = row.goalId ? scopedFor(row.goalId) : org;
      if (row.effect === "deny") target.denies.add(row.permission);
      else target.grants.add(row.permission);
    }

    const freeze = (scoped: MutableScoped): ScopedSetDto => ({
      grants: [...scoped.grants],
      denies: [...scoped.denies],
    });

    return CapabilitySet.from(
      explanation.entitlement.narrow({
        wildcard: false,
        org: freeze(org),
        goals: Object.fromEntries([...goals].map(([id, scoped]) => [id, freeze(scoped)])),
      }),
    );
  }
}
