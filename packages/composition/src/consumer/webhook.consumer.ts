import { QueueName, type WebhookJob } from "../import.js";
import { QueueConsumer } from "./queue.consumer.js";
import type { QueueJob } from "./queue-job.js";

// One event to one webhook. A throw is the retry; the use-case stops throwing once the
// webhook is switched off, so a dead endpoint ends its jobs rather than repeating them.
export class WebhookConsumer extends QueueConsumer {
  public readonly queue = QueueName.WEBHOOK;

  public async handle(job: QueueJob): Promise<void> {
    const data = job.data as WebhookJob;
    await this.placed(data.organizationId, () => this.container.webhooks.deliver.execute(data));
  }
}
