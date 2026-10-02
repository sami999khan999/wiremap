import type { OrganizationId, PaginationQuery, RoleId, UserId } from "../import.js";

// One person's membership of the tenant, joined to what a list needs to render it.
export interface MemberRecord {
  readonly userId: UserId;
  readonly name: string;
  readonly email: string;
  readonly roleId: RoleId;
  readonly roleKey: string;
  readonly roleName: string;
  readonly joinedAt: Date;
  readonly deactivated: boolean;
  // `users.suspended_at`: the platform's lock, in every tenant at once.
  readonly suspended: boolean;
  // Live overrides — a role review's drift, read in the same statement as the member.
  readonly exceptions: number;
}

export interface MemberPage {
  readonly items: readonly MemberRecord[];
  readonly total: number;
}

// A repository port, so it lives with its subject rather than in `port/`.
export abstract class MemberRepository {
  // Takes the tenant explicitly rather than a `Principal`, as `RoleRepository` does:
  // the use-case is where authorization happens.
  public abstract list(organizationId: OrganizationId, page: PaginationQuery): Promise<MemberPage>;

  // Whether an address already belongs to someone in the tenant. Compared
  // case-insensitively by the adapter, so the caller need not normalise.
  public abstract existsByEmail(organizationId: OrganizationId, email: string): Promise<boolean>;

  // Null rather than a throw: "not a member of this tenant" is the same answer as
  // "no such user", and the use-case turns either into `NOT_FOUND`.
  public abstract findByUser(
    organizationId: OrganizationId,
    userId: UserId,
  ): Promise<MemberRecord | null>;

  public abstract changeRole(
    organizationId: OrganizationId,
    userId: UserId,
    roleId: RoleId,
  ): Promise<void>;

  // Null reactivates. One method rather than two, because the column is one value and
  // two setters would let them disagree about what "active" means.
  public abstract setDeactivatedAt(
    organizationId: OrganizationId,
    userId: UserId,
    at: Date | null,
  ): Promise<void>;

  // Active, unsuspended holders of any of `roleKeys`. The last-owner rule is about who can
  // still act, so a deactivated or suspended owner does not keep a tenant unlockable.
  public abstract countActiveHolders(
    organizationId: OrganizationId,
    roleKeys: readonly string[],
  ): Promise<number>;

  // The same count with every row locked, and **only** valid inside a transaction. Two
  // concurrent demotions both read two holders otherwise and leave the tenant with none.
  public abstract lockActiveHolders(
    organizationId: OrganizationId,
    roleKeys: readonly string[],
  ): Promise<number>;
}
