import type { Container } from "../container/index.js";
import { EmbeddingConsumer } from "./embedding.consumer.js";
import { MailConsumer } from "./mail.consumer.js";
import { MaintenanceConsumer } from "./maintenance.consumer.js";
import { NotificationConsumer } from "./notification.consumer.js";
import { OutboxConsumer } from "./outbox.consumer.js";
import type { QueueConsumer } from "./queue.consumer.js";
import type { QueueJob } from "./queue-job.js";

// Every queue's consumer, by queue name. The worker and `/api/internal/job` both run
// jobs through this, so a job behaves the same whichever host delivered it.
export class ConsumerRegistry {
  private readonly byQueue: ReadonlyMap<string, QueueConsumer>;

  public constructor(container: Container) {
    const consumers: readonly QueueConsumer[] = [
      new EmbeddingConsumer(container),
      new MailConsumer(container),
      new MaintenanceConsumer(container),
      new NotificationConsumer(container),
      new OutboxConsumer(container),
    ];
    this.byQueue = new Map(consumers.map((consumer) => [consumer.queue, consumer]));
  }

  public queues(): readonly string[] {
    return [...this.byQueue.keys()];
  }

  public consumerFor(queue: string): QueueConsumer {
    const consumer = this.byQueue.get(queue);
    if (!consumer) throw new Error(`No consumer for queue: ${queue}`);
    return consumer;
  }

  // Runs one delivery and reports it either way. It rethrows, because the host's retry is
  // what a rejection is for.
  public async run(queue: string, job: QueueJob, now: () => number = Date.now): Promise<void> {
    const consumer = this.consumerFor(queue);
    const startedAt = now();
    try {
      await consumer.handle(job);
    } catch (error) {
      consumer.failed(job, error);
      throw error;
    }
    consumer.completed(job, now() - startedAt);
  }
}
