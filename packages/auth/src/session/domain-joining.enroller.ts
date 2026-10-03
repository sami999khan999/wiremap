import type { OrganizationId, UserId } from "../import.js";
import type { MemberDomainClaimer } from "./member-domain.claimer.js";
import { MembershipEnroller } from "./membership.enroller.js";

// After a pending invitation and before the mode's own answer: a person someone invited
// joins that organization; otherwise one whose domain is claimed joins that one.
export class DomainJoiningEnroller extends MembershipEnroller {
  public constructor(
    private readonly domains: MemberDomainClaimer,
    private readonly inner: MembershipEnroller,
  ) {
    super();
  }

  public async enrol(userId: UserId): Promise<OrganizationId | null> {
    return (await this.domains.claimByDomain(userId)) ?? this.inner.enrol(userId);
  }
}
