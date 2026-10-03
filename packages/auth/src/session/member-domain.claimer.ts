import type { OrganizationId, UserId } from "../import.js";

// Auto-join: a new person whose verified address is at a claimed domain joins that
// organization. Null when the address is unverified or at no claimed domain.
export abstract class MemberDomainClaimer {
  public abstract claimByDomain(userId: UserId): Promise<OrganizationId | null>;
}
