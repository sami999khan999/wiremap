import {
  ConflictError,
  type EntitlementMask,
  ForbiddenError,
  type PermissionKey,
  PermissionRegistry,
  ValidationError,
} from "../import.js";
import type { Principal } from "../primitive/index.js";
import type { RoleRecord } from "./role.repository.js";

// Frozen at module load rather than a `static readonly`, which freezes the binding and
// not the array.
const RESERVED_KEYS: ReadonlySet<string> = Object.freeze(
  // `platform_admin` is `PlatformRoleSeed`'s, reserved for the reason the other four
  // are: a user-created role by that key collects every platform key on the next deploy.
  new Set(["owner", "admin", "member", "guest", "platform_admin"]),
);

// The rules every role write shares. Written once, because a create that allows what an
// update refuses is a hole reachable by creating and then editing.
export class RoleRules {
  private constructor() {}

  // `SystemRoleSeed` resolves its rows by `(organization_id, key)` and grants them its
  // own permission list. A user-created `owner` would collect every key on re-seed.
  public static isReservedKey(key: string): boolean {
    return RESERVED_KEYS.has(key);
  }

  public static reservedKeys(): readonly string[] {
    return [...RESERVED_KEYS];
  }

  // Seeded rows are rewritten on every deploy, so an edit survives until the next one
  // and then vanishes with no trace and no error.
  public static assertEditable(role: RoleRecord): void {
    if (role.isSystem) throw new ConflictError("role", "system");
  }

  // A goal role belongs on `goal_members`, never on `memberships`: assigned as one it
  // would hand its keys out across the whole tenant instead of inside one goal.
  // ──
  // Not "org only". `platform_admin` is `scope: "platform"` and *is* a membership row,
  // in the one organization marked `is_platform`.
  public static assertMembershipScope(role: RoleRecord): void {
    if (role.scope === "goal") throw new ConflictError("role", "scope");
  }

  public static assertKnownPermission(permission: string): PermissionKey {
    if (!PermissionRegistry.instance.isKnown(permission)) {
      throw new ValidationError([{ field: "permission", rule: "unknown" }]);
    }
    return permission;
  }

  // No escalation by assignment: the actor must hold every key of the role. Un-entitled
  // keys are skipped — grants are filtered, never deleted, so `owner` still lists them.
  public static assertAssignableBy(
    actor: Principal,
    role: RoleRecord,
    entitlement: EntitlementMask,
  ): void {
    // `CapabilitySet.cannotAssign`, which the role pickers run too, so they never offer one
    // the server would refuse.
    const missing = actor.capabilities.cannotAssign(role.permissions, (key) =>
      entitlement.isEntitled(key),
    );
    if (missing) throw new ForbiddenError(missing);
  }
}
