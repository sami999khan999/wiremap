import {
  CORE_MODULE,
  ConflictError,
  type PermissionKey,
  PermissionRegistry,
  ValidationError,
} from "../import.js";

export class AccountRules {
  // The key that can undo a suspend or a deny. Losing its last holder locks the platform
  // out of its own recovery, which is why `RV.14` puts a guard in front of both.
  public static readonly RECOVERY_KEY: PermissionKey = "platform.account.manage";

  private constructor() {}

  // Known, and not `core`: a `core` key is held by everyone, so denying it breaks sign-in.
  public static assertDeniable(value: string): PermissionKey {
    const registry = PermissionRegistry.instance;
    if (!registry.isKnown(value)) {
      throw new ValidationError([{ field: "permission", rule: "unknown" }]);
    }
    if (registry.meta(value)?.module === CORE_MODULE) {
      throw new ValidationError([{ field: "permission", rule: "unoverridable" }]);
    }
    return value;
  }

  public static isPlatformKey(key: PermissionKey): boolean {
    return PermissionRegistry.instance.meta(key)?.scope === "platform";
  }

  // Whether taking these keys away takes the recovery key too. A deny of the read key
  // closes over the manage key, which requires it.
  public static reachesRecovery(keys: readonly string[]): boolean {
    return keys.includes(AccountRules.RECOVERY_KEY);
  }

  public static assertNotSelf(actorId: string, targetId: string): void {
    if (actorId === targetId) throw new ConflictError("account", "self");
  }

  // The target is a live holder and nobody else is: the one change that leaves the tier
  // unable to reinstate anyone, itself included.
  public static assertNotLastHolder(holders: readonly string[], targetId: string): void {
    if (holders.includes(targetId) && holders.every((id) => id === targetId)) {
      throw new ConflictError("account", "last-admin");
    }
  }

  public static assertReason(reason: string | null): string {
    const trimmed = reason?.trim() ?? "";
    if (trimmed === "") throw new ValidationError([{ field: "reason", rule: "required" }]);
    if (trimmed.length > 500) throw new ValidationError([{ field: "reason", rule: "max" }]);
    return trimmed;
  }
}
