import type { MemberRecord } from "./member.repository.js";

// The two questions the lifecycle use-cases both ask, in one place: written twice they
// would eventually disagree about what "owner" means.
export class MemberRules {
  private constructor() {}

  // The seeded role listing every tenant key. `SystemRoleSeed` creates it per tenant, so the key is
  // the stable handle rather than any particular row's id.
  public static readonly OWNER_KEY = "owner";

  public static isOwnerKey(key: string): boolean {
    return key === MemberRules.OWNER_KEY;
  }

  public static isOwner(member: MemberRecord): boolean {
    return MemberRules.isOwnerKey(member.roleKey);
  }

  // The platform organization's top role, holding every key. Only that organization has it.
  public static readonly PLATFORM_ADMIN_KEY = "platform_admin";

  // What must stay held after a member leaves `from` for `to` (`null` is deactivation). The
  // last platform admin is guarded alone; the last owner counts platform admins as owners too.
  public static lastHolderGuard(
    from: string,
    to: string | null,
  ): {
    readonly keys: readonly string[];
    readonly reason: "lastOwner" | "lastPlatformAdmin";
  } | null {
    if (from === MemberRules.PLATFORM_ADMIN_KEY && to !== from) {
      return { keys: [MemberRules.PLATFORM_ADMIN_KEY], reason: "lastPlatformAdmin" };
    }
    const top = [MemberRules.OWNER_KEY, MemberRules.PLATFORM_ADMIN_KEY];
    if (from === MemberRules.OWNER_KEY && (to === null || !top.includes(to))) {
      return { keys: top, reason: "lastOwner" };
    }
    return null;
  }

  // Seven days. Long enough to survive a weekend, short enough that a link forwarded
  // months later opens nothing.
  private static readonly INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

  // Here rather than in the two use-cases that need it: a resend that extended the
  // window by a different number would be a second policy nobody decided on.
  public static invitationExpiry(now: Date): Date {
    return new Date(now.getTime() + MemberRules.INVITATION_TTL_MS);
  }
}
