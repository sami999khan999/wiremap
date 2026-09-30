import {
  AuthMailer,
  type MailPublisher,
  type MailRecipient,
  type MailTemplateKey,
} from "../import.js";

// Every one of these is a message somebody is waiting in front of a screen for, which is
// what `high` means: five attempts, and ahead of anything else on the queue.
export class QueuedAuthMailer extends AuthMailer {
  public constructor(private readonly mail: MailPublisher) {
    super();
  }

  public override sendVerification(to: MailRecipient, url: string): Promise<void> {
    return this.link("auth.verify", to, url);
  }

  public override sendPasswordReset(to: MailRecipient, url: string): Promise<void> {
    return this.link("auth.reset", to, url);
  }

  public override sendEmailChangeConfirmation(to: MailRecipient, url: string): Promise<void> {
    return this.link("auth.change", to, url);
  }

  public override sendTwoFactorOtp(to: MailRecipient, code: string): Promise<void> {
    return this.mail.publish({
      template: "auth.otp",
      to: to.email,
      locale: to.locale,
      params: { code },
      organizationId: null,
      userId: to.userId,
      priority: "high",
    });
  }

  // No `dedupeKey` on any of them. Better Auth issues a fresh single-use token each time,
  // so suppressing the second send would mail a link the server has already replaced.
  private link(
    template: Extract<MailTemplateKey, "auth.verify" | "auth.reset" | "auth.change">,
    to: MailRecipient,
    url: string,
  ): Promise<void> {
    return this.mail.publish({
      template,
      to: to.email,
      locale: to.locale,
      params: { url },
      // Authentication happens before a tenant is chosen, so there is never one here.
      organizationId: null,
      userId: to.userId,
      priority: "high",
    });
  }
}
