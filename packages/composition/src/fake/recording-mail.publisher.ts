import { MailPublisher, type MailRequest } from "../import.js";

export interface PublishedMail {
  readonly template: string;
  readonly to: string;
  readonly locale: string;
  readonly params: unknown;
  readonly priority: "high" | "normal" | undefined;
  readonly dedupeKey: string | undefined;
}

// Records rather than queues. The assertion worth writing is "an invitation to that
// address, once, in that person's language", and it needs neither Redis nor SMTP.
export class RecordingMailPublisher extends MailPublisher {
  private readonly mails: PublishedMail[] = [];

  public override publish(mail: MailRequest): Promise<void> {
    // Suppressed here for the same reason BullMQ suppresses it there: a caller that
    // passes a `dedupeKey` is asserting once, and a fake that ignores it proves nothing.
    const duplicate =
      mail.dedupeKey !== undefined && this.mails.some((sent) => sent.dedupeKey === mail.dedupeKey);
    if (duplicate) return Promise.resolve();

    this.mails.push({
      template: mail.template,
      to: mail.to,
      locale: mail.locale,
      params: mail.params,
      priority: mail.priority,
      dedupeKey: mail.dedupeKey,
    });
    return Promise.resolve();
  }

  public published(): readonly PublishedMail[] {
    return this.mails;
  }

  public publishedTo(address: string): readonly PublishedMail[] {
    return this.mails.filter((mail) => mail.to === address);
  }
}
