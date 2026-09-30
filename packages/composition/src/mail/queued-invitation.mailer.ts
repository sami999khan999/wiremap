import {
  type InvitationMail,
  InvitationMailer,
  Locales,
  type MailPublisher,
  ROUTES,
} from "../import.js";

// The one message the member slice sends. It goes to somebody who may not have an account
// yet, so there is no `users.locale` to read and the default is the only honest choice.
export class QueuedInvitationMailer extends InvitationMailer {
  public constructor(
    private readonly mail: MailPublisher,
    // The origin the app is served from. Absolute, because the link is opened from a mail
    // client rather than from a page on this site.
    private readonly baseUrl: string,
  ) {
    super();
  }

  public override send(mail: InvitationMail): Promise<void> {
    // The same literal the landing page's `createFileRoute` spells, from the one place
    // that owns it.
    const url = `${this.baseUrl}${ROUTES.shell.invitation}/${mail.token}`;

    return this.mail.publish({
      template: "member.invitation",
      to: mail.to,
      locale: Locales.DEFAULT,
      params: { url, inviter: mail.inviterName, organization: mail.organizationName },
      // No `dedupeKey`: re-inviting replaces the row and issues a new token, so a
      // suppressed second send would mail a link the database no longer accepts.
      organizationId: mail.organizationId,
      // The invitee has no account yet, which is the whole reason this message exists.
      userId: null,
    });
  }
}
