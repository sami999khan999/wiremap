import type { OrganizationId, UserId } from "../import.js";

// One tenant the account belongs to, as the platform's account screen lists it.
export interface AccountMembership {
  readonly organizationId: OrganizationId;
  readonly name: string;
  readonly slug: string;
  readonly roleName: string;
  // The tenant's own lock, which a platform reinstate does not lift.
  readonly deactivated: boolean;
}

// A deny the platform wrote. The tenant's own exceptions are its admin's, and not listed.
export interface AccountDeny {
  readonly id: string;
  readonly organizationId: OrganizationId;
  readonly permission: string;
  readonly reason: string | null;
  readonly createdAt: Date;
}

export interface AccountRecord {
  readonly userId: UserId;
  readonly email: string;
  readonly name: string;
  readonly suspendedAt: Date | null;
  readonly memberships: readonly AccountMembership[];
  readonly denies: readonly AccountDeny[];
}

// The `users` row read across every tenant, with its memberships and the platform's
// denies. All catalog, overrides included, so one placement answers the whole screen.
export abstract class AccountRepository {
  public abstract findByEmail(email: string): Promise<AccountRecord | null>;

  public abstract findById(userId: UserId): Promise<AccountRecord | null>;

  // A state, never a delete: the activity log points at this row forever.
  public abstract saveSuspension(userId: UserId, suspendedAt: Date | null): Promise<void>;

  // Who can still use the key through a role in the tier: an active membership, an account
  // not suspended, and no platform deny of it. What `RV.14` counts before a lockout.
  public abstract holdersOf(
    platformOrganizationId: OrganizationId,
    permission: string,
  ): Promise<readonly UserId[]>;
}
