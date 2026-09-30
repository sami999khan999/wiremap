import type {
  Locale,
  MailTemplateKey,
  MailTemplateParams,
  OrganizationId,
  UserId,
} from "../import.js";

export interface MailRequest<K extends MailTemplateKey = MailTemplateKey> {
  readonly template: K;
  readonly to: string;
  // The recipient's, not the request's: mail is read long after the click that caused it,
  // in whatever language that person set.
  readonly locale: Locale;
  readonly params: MailTemplateParams<K>;
  // Null for mail that belongs to no tenant — every message Better Auth sends, and an
  // invitation to somebody who does not have an account yet.
  readonly organizationId: OrganizationId | null;
  readonly userId: UserId | null;
  // "High" is the mail a person is sitting and waiting for. Two values rather than a
  // number, because a caller choosing 37 is choosing against every other caller.
  readonly priority?: "high" | "normal";
  // Becomes the job id, so "send this once" is expressed where the queue already
  // enforces it rather than as a row a second process has to check.
  readonly dedupeKey?: string;
}

// What every caller holds. It returns nothing on purpose: there is no delivery row, so a
// caller reading an id back would be reaching for a record that does not exist.
export abstract class MailPublisher {
  public abstract publish<K extends MailTemplateKey>(mail: MailRequest<K>): Promise<void>;

  // A digest page or a notification's recipients, at once. The default is one each; the
  // queued adapter sends them as one batch.
  public async publishMany(mails: readonly MailRequest[]): Promise<void> {
    for (const mail of mails) await this.publish(mail);
  }
}
