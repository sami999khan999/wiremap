import {
  type Logger,
  MailPublisher,
  type MailRequest,
  QueueName,
  type QueuePublisher,
} from "../import.js";

// BullMQ orders by ascending priority. Two values, because the only distinction that has
// ever mattered is whether somebody is sitting in front of a screen waiting for it.
const PRIORITY = Object.freeze({ high: 1, normal: 5 });

// Doubling from five seconds: ten attempts wait about forty minutes for the mail a sign-up
// cannot complete without, eight about ten for everything else.
const ATTEMPTS = Object.freeze({ high: 10, normal: 8 });

// A day: the digest's key names its day, and every automatic re-send lands inside it. A
// job id held only while the completed job was kept. See docs/reference/mail-pipeline.md.
const ONCE_WITHIN_SECONDS = 86_400;

// The whole publisher. There is no row, no status and no sweep — see
// docs/reference/mail-pipeline.md.
export class QueuedMailPublisher extends MailPublisher {
  public constructor(
    private readonly queue: QueuePublisher,
    // Optional for the same reason `SmtpEmailSender`'s is: a spec asserting on job options
    // should not have to build a logger to do it.
    private readonly logger?: Logger,
  ) {
    super();
  }

  // It does not catch. With no durable record behind the enqueue there is nothing for a
  // swallowed failure to be secondary to, and a caller that cannot queue mail should learn.
  public override async publish(mail: MailRequest): Promise<void> {
    await this.queue.publish(QueueName.MAIL, mail, QueuedMailPublisher.options(mail));
    this.queued(mail);
  }

  public override async publishMany(mails: readonly MailRequest[]): Promise<void> {
    await this.queue.publishMany(
      QueueName.MAIL,
      mails.map((mail) => ({ payload: mail, options: QueuedMailPublisher.options(mail) })),
    );
    for (const mail of mails) this.queued(mail);
  }

  private static options(mail: MailRequest) {
    const priority = mail.priority ?? "normal";
    return {
      name: "send",
      // The caller's "send this once", expressed where BullMQ already enforces it.
      ...(mail.dedupeKey === undefined
        ? {}
        : { onceWithin: { id: mail.dedupeKey, seconds: ONCE_WITHIN_SECONDS } }),
      priority: PRIORITY[priority],
      attempts: ATTEMPTS[priority],
    };
  }

  // No recipient on the line. An address is the highest-cardinality field this system
  // holds, and a log platform is not where it belongs.
  private queued(mail: MailRequest): void {
    this.logger?.emit("mail.delivery.queued", {
      template: mail.template,
      priority: mail.priority ?? "normal",
    });
  }
}
