// The direct file, not `../registry/index.js`: that barrel loads `module-registry.ts`,
// which imports this folder back.
import { type PermissionKey, PermissionRegistry } from "../registry/permission-registry.js";
import { type CapabilitySetDto, CORE_MODULE, type ScopedSetDto } from "./capability-set.js";

export interface EntitlementInput {
  // `"all"` is the unlimited plan, resolved per question rather than listed, so a key a
  // later deploy adds is entitled without anyone reseeding a row.
  readonly plan: readonly string[] | "all";
  readonly added: readonly string[];
  readonly removed: readonly string[];
  readonly disabledModules: readonly string[];
}

// What an org's plan allows, as a filter over the grants its roles hold. Grants are
// filtered, never deleted: see docs/reference/entitlement-mask.md.
export class EntitlementMask {
  private constructor(
    private readonly plan: ReadonlySet<string> | "all",
    private readonly added: ReadonlySet<string>,
    private readonly removed: ReadonlySet<string>,
    private readonly disabled: ReadonlySet<string>,
  ) {}

  public static from(input: EntitlementInput): EntitlementMask {
    return new EntitlementMask(
      input.plan === "all" ? "all" : new Set(input.plan),
      new Set(input.added),
      new Set(input.removed),
      new Set(input.disabledModules),
    );
  }

  // A disabled module and a remove beat the plan and an add. `core` and `platform` keys
  // are outside the mask entirely: everyone holds one, and no tenant plan reaches the other.
  public isEntitled(key: PermissionKey): boolean {
    const meta = PermissionRegistry.instance.meta(key);
    const module = meta?.module ?? key.split(".")[0] ?? "";
    if (module === CORE_MODULE || meta?.scope === "platform") return true;
    if (this.disabled.has(module) || this.removed.has(key)) return false;
    if (this.added.has(key)) return true;
    return this.plan === "all" || this.plan.has(key);
  }

  public keys(): readonly PermissionKey[] {
    return Object.freeze(PermissionRegistry.instance.all().filter((key) => this.isEntitled(key)));
  }

  // Grants only, org and goal. Denies pass through, because a mask that dropped one would
  // widen access; the platform axis passes through, because no plan reaches it.
  public narrow(dto: CapabilitySetDto): CapabilitySetDto {
    return {
      ...dto,
      org: this.narrowSet(dto.org),
      goals: Object.fromEntries(
        Object.entries(dto.goals).map(([goalId, set]): [string, ScopedSetDto] => [
          goalId,
          this.narrowSet(set),
        ]),
      ),
    };
  }

  private narrowSet(set: ScopedSetDto): ScopedSetDto {
    return { grants: set.grants.filter((key) => this.isEntitled(key)), denies: set.denies };
  }
}
