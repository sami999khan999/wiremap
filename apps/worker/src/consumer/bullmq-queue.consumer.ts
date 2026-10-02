import type { ConsumerRegistry, Container, Job, QueueJob, Redis } from "../import.js";
import { Worker } from "../import.js";

export interface BullMqQueueOptions {
  readonly concurrency: number;
  // A provider's rate limit is a property of one queue. One limiter here is what keeps
  // it out of every caller as a sleep.
  readonly limiter?: { readonly max: number; readonly duration: number };
  // BullMQ's 30 s default is sized for short jobs. A runway pass is minutes of paced DDL.
  readonly lockDuration?: number;
}

// Hosts one queue's consumer on BullMQ. The work is the registry's, shared with
// `/api/internal/job`; this file only turns a BullMQ job into a `QueueJob`.
export class BullMqQueueConsumer {
  public constructor(
    private readonly container: Container,
    private readonly registry: ConsumerRegistry,
    private readonly connection: Redis,
    private readonly queue: string,
    private readonly options: BullMqQueueOptions,
  ) {}

  public start(): Worker {
    const worker = new Worker(
      this.queue,
      async (job: Job) => this.registry.run(this.queue, BullMqQueueConsumer.envelope(job)),
      {
        connection: this.connection,
        concurrency: this.options.concurrency,
        ...(this.options.limiter ? { limiter: { ...this.options.limiter } } : {}),
        ...(this.options.lockDuration ? { lockDuration: this.options.lockDuration } : {}),
      },
    );

    worker.on("stalled", (jobId) => {
      this.container.logger.emit("queue.job.stalled", { queue: this.queue, jobId });
    });

    return worker;
  }

  // `attemptsMade` counts the failures before this delivery, so this one is that plus one.
  public static envelope(job: Job): QueueJob {
    return {
      id: job.id ?? "unknown",
      name: job.name,
      data: job.data,
      attempt: job.attemptsMade + 1,
      maxAttempts: job.opts.attempts ?? 1,
    };
  }
}
