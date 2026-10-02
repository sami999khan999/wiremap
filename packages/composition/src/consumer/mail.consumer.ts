import { QueueName } from "../import.js";
import { QueueConsumer } from "./queue.consumer.js";
import type { QueueJob } from "./queue-job.js";
import { SystemPrincipal } from "./system-principal.js";

interface MailJobData {
  readonly template: string;
  readonly to: string;
  readonly locale: string;
  readonly params: unknown;
}

export class MailConsumer extends QueueConsumer {
  public readonly queue = QueueName.MAIL;

  // An unknown job name throws rather than succeeding quietly.
  public async handle(job: QueueJob): Promise<void> {
    switch (job.name) {
      case "send": {
        const data = job.data as MailJobData;
        const receipt = await this.container.mail.send.execute(SystemPrincipal.platform(), {
          template: data.template,
          to: data.to,
          locale: data.locale as never,
          params: data.params,
        });

        // The id a provider webhook would later correlate against. Empty when the server
        // gave none.
        this.container.logger.emit("mail.delivery.sent", {
          template: data.template,
          messageId: receipt.messageId ?? "",
        });
        return;
      }
      default:
        throw new Error(`Unknown mail job: ${job.name}`);
    }
  }

  // The only place a permanently undelivered message is reported. With no delivery
  // table, this line and `mail.delivery.sent` are the record.
  public override failed(job: QueueJob, error: unknown): void {
    super.failed(job, error);
    if (job.attempt < job.maxAttempts) return;
    this.container.logger.emit("mail.delivery.failed", {
      template: (job.data as Partial<MailJobData> | null)?.template ?? "unknown",
      attempts: job.attempt,
    });
  }
}
