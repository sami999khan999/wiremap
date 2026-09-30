import { CORE_MODULE, type PermissionKey, PermissionRegistry, ValidationError } from "../import.js";

// A plan key names a row an operator types and a URL carries: lowercase, kebab, bounded.
const PLAN_KEY = /^[a-z0-9][a-z0-9-]{0,62}$/;

const REASON_MAX = 500;

// Out of every plan, adjustment and switch: `core` is everyone's, and masking `platform`
// would lock out the people who fix incidents.
const UNMASKED = new Set([CORE_MODULE, "platform"]);

// What may go into a plan, an adjustment or a module switch. See
// packages/permissions/docs/reference/entitlement-mask.md.
export class EntitlementRules {
  private constructor() {}

  // Known, and a tenant key a plan can mask: no `core` module, no `platform` scope.
  public static assertMaskable(value: string, field = "permission"): PermissionKey {
    const registry = PermissionRegistry.instance;
    if (!registry.isKnown(value)) throw new ValidationError([{ field, rule: "unknown" }]);
    const meta = registry.meta(value);
    if (!meta || meta.scope === "platform" || UNMASKED.has(meta.module)) {
      throw new ValidationError([{ field, rule: "unmaskable" }]);
    }
    return value;
  }

  // A plan is stored closed over `requires`, so no key in it is entitled and unusable.
  public static closePlan(permissions: readonly string[]): readonly PermissionKey[] {
    const keys = permissions.map((key) => EntitlementRules.assertMaskable(key, "permissions"));
    return PermissionRegistry.instance.closure(keys);
  }

  // An add brings what it needs; a remove takes what depends on it. Either way the org is
  // never left entitled to a key that cannot work.
  public static closeAdjustment(
    key: PermissionKey,
    effect: "add" | "remove",
  ): readonly PermissionKey[] {
    const registry = PermissionRegistry.instance;
    return effect === "add" ? registry.closure([key]) : registry.dependentClosure([key]);
  }

  public static assertPlanKey(key: string): string {
    if (!PLAN_KEY.test(key)) throw new ValidationError([{ field: "key", rule: "format" }]);
    return key;
  }

  public static assertReason(reason: string): string {
    const trimmed = reason.trim();
    if (trimmed === "") throw new ValidationError([{ field: "reason", rule: "required" }]);
    if (trimmed.length > REASON_MAX) throw new ValidationError([{ field: "reason", rule: "max" }]);
    return trimmed;
  }

  // A module some key declares, and not one the mask never reaches.
  public static assertSwitchable(module: string): string {
    if (!PermissionRegistry.instance.modules().includes(module) || UNMASKED.has(module)) {
      throw new ValidationError([{ field: "module", rule: "unswitchable" }]);
    }
    return module;
  }

  // Every key a plan can mask, in catalog order: the universe a plan is edited over.
  public static maskableKeys(): readonly PermissionKey[] {
    return PermissionRegistry.instance.all().filter((key) => {
      const meta = PermissionRegistry.instance.meta(key);
      return meta !== undefined && meta.scope !== "platform" && !UNMASKED.has(meta.module);
    });
  }

  // The modules a switch may turn off, in catalog order.
  public static switchable(): readonly string[] {
    return PermissionRegistry.instance.modules().filter((module) => !UNMASKED.has(module));
  }
}
