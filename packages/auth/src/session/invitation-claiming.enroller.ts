import type { OrganizationId, UserId } from "../import.js";
import type { InvitationClaimer } from "./invitation.claimer.js";
import { MembershipEnroller } from "./membership.enroller.js";

// Wraps whichever enroller `AUTH_ENROLMENT_MODE` picked; only an uninvited address
// falls through to the mode's own answer. See docs/reference/enrolment.md.
export class InvitationClaimingEnroller extends MembershipEnroller {
  public constructor(
    private readonly claimer: InvitationClaimer,
    private readonly inner: MembershipEnroller,
  ) {
    super();
  }

  public async enrol(userId: UserId): Promise<OrganizationId | null> {
    return (await this.claimer.claimPending(userId)) ?? this.inner.enrol(userId);
  }
}
