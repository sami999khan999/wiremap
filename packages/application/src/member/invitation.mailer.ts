import type { OrganizationId } from "../import.js";

// Everything the message needs and nothing about wording or routes — the implementation
// owns both, which keeps this package free of copy.
export interface InvitationMail {
  readonly to: string;
  readonly organizationId: OrganizationId;
  readonly organizationName: string;
  readonly inviterName: string;
  readonly token: string;
}

// A port in the slice rather than in `port/`: only this slice sends one, and the test
// for `port/` is whether a second feature adds a method here or a file beside it.
export abstract class InvitationMailer {
  public abstract send(mail: InvitationMail): Promise<void>;
}
