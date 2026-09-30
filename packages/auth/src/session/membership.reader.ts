import type { OrganizationId, UserId } from "../import.js";

// One tenant a user may switch to, as the switcher renders it.
export interface OrganizationSummary {
  readonly id: OrganizationId;
  readonly name: string;
  readonly slug: string;
  // The role *this* user holds here, which differs per tenant. It comes from the join
  // `organizationsFor` already makes rather than from a second query.
  readonly roleName: string;
}

// Which organization is this session for, plus the two questions a switch needs.
// Declared here, not in `application`: no use-case should learn sessions have a tenant.
export abstract class MembershipReader {
  // Null fails the sign-in: a `Principal` with no organization reads every tenant's rows.
  // Prefers `last_active_organization_id` while still a member, oldest membership after.
  public abstract activeOrganizationFor(userId: UserId): Promise<OrganizationId | null>;

  // Every tenant the user may switch to, oldest first. Read once per SSR pass.
  public abstract organizationsFor(userId: UserId): Promise<readonly OrganizationSummary[]>;

  // False for a deactivated membership *and* for no membership at all, because the
  // answer is the same either way: no principal, and no switching the session there.
  public abstract isActive(userId: UserId, organizationId: OrganizationId): Promise<boolean>;

  // How many tenants this person owns. A count rather than `organizationsFor().length`:
  // the cap is checked on a write path, and that read is capped itself.
  public abstract ownedCount(userId: UserId): Promise<number>;

  // The platform's suspend, asked before the tenant is resolved: the readers above already
  // answer a suspended user as a member of nothing, and sign-in would say only "failed".
  public abstract isSuspended(userId: UserId): Promise<boolean>;
}
