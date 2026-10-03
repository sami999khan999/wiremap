import type { OrganizationId, UserId } from "../import.js";

// What a shareable link reveals before anyone signs in: which organization, which role,
// and whether it still works. Nothing that admits anyone without a verified mailbox.
export interface InvitationLinkPreview {
  readonly organizationName: string;
  readonly roleName: string;
  readonly usable: boolean;
}

// Turns a shareable link into a membership for a signed-in, verified person. The token
// locates the link; the verified address is the credential, as for an invitation.
export abstract class InvitationLinkClaimer {
  public abstract preview(token: string): Promise<InvitationLinkPreview | null>;

  public abstract claimByToken(userId: UserId, token: string): Promise<OrganizationId | null>;
}
