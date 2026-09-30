import type { OrganizationId, UserId } from "../import.js";

// What an invitation link reveals before anyone signs in: enough for the landing page
// to say who invited whom, and nothing that could be used without the mailbox.
export interface InvitationPreview {
  readonly organizationName: string;
  readonly email: string;
  readonly expired: boolean;
}

// Turns an invitation into a membership. A token is only how the row is found — the
// verified mailbox is the credential. See docs/reference/enrolment.md.
export abstract class InvitationClaimer {
  public abstract preview(token: string): Promise<InvitationPreview | null>;

  // The accept endpoint's path: a signed-in person holding the link. Null when there is
  // no pending, unexpired invitation for *this user's* address under that token.
  public abstract claimByToken(userId: UserId, token: string): Promise<OrganizationId | null>;

  // The enrolment path: a brand-new user's first session, with no token in hand. The
  // oldest pending invitation for their address wins; null means there was none.
  public abstract claimPending(userId: UserId): Promise<OrganizationId | null>;
}
