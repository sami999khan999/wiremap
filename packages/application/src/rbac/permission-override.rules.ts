import {
  CORE_MODULE,
  ConflictError,
  type EntitlementMask,
  ForbiddenError,
  type PermissionKey,
  PermissionRegistry,
  ValidationError,
} from "../import.js";
import type { MemberRecord } from "../member/member.repository.js";
import type { Principal } from "../primitive/index.js";
import type { RoleRecord } from "./role.repository.js";
import { RoleRules } from "./role.rules.js";

const DAY_MS = 86_400_000;

// A grant is access nobody reviews, so it lapses: thirty days unless someone says
// otherwise, ninety at most. A deny is safe to leave, so it never does.
export class PermissionOverrideRules {
  public static readonly DEFAULT_DAYS = 30;

  public static readonly MAX_DAYS = 90;

  private constructor() {}

  // Known, and not `core` (held by everyone) or `platform` (above every tenant).
  public static assertOverridable(value: string): PermissionKey {
    const registry = PermissionRegistry.instance;
    if (!registry.isKnown(value)) {
      throw new ValidationError([{ field: "permission", rule: "unknown" }]);
    }
    const meta = registry.meta(value);
    if (!meta || meta.module === CORE_MODULE || meta.scope === "platform") {
      throw new ValidationError([{ field: "permission", rule: "unoverridable" }]);
    }
    return value;
  }

  // The requested end, or thirty days from now. Past, or beyond ninety, is refused.
  public static expiryFor(requested: Date | null, now: Date): Date {
    const latest = now.getTime() + PermissionOverrideRules.MAX_DAYS * DAY_MS;
    if (requested === null) {
      return new Date(now.getTime() + PermissionOverrideRules.DEFAULT_DAYS * DAY_MS);
    }
    if (requested.getTime() <= now.getTime()) {
      throw new ValidationError([{ field: "expiresAt", rule: "past" }]);
    }
    if (requested.getTime() > latest) {
      throw new ValidationError([{ field: "expiresAt", rule: "max" }]);
    }
    return requested;
  }

  public static assertReason(reason: string | null): string {
    const trimmed = reason?.trim() ?? "";
    if (trimmed === "") throw new ValidationError([{ field: "reason", rule: "required" }]);
    if (trimmed.length > 500) throw new ValidationError([{ field: "reason", rule: "max" }]);
    return trimmed;
  }

  // Who may be given an exception: a member, never the actor, and never someone whose
  // role the actor could not have handed out — the same no-escalation rule as assigning it.
  public static assertTarget(
    actor: Principal,
    member: MemberRecord,
    role: RoleRecord,
    entitlement: EntitlementMask,
  ): void {
    if (member.userId === actor.userId) throw new ConflictError("override", "self");
    RoleRules.assertAssignableBy(actor, role, entitlement);
  }

  // An exception can move only what the actor holds across the whole tenant: a goal-level
  // holder writing an org-level row would be handing out more than they have.
  public static assertHeld(actor: Principal, key: PermissionKey): void {
    if (!actor.canTenantWide(key)) throw new ForbiddenError(key);
  }
}
