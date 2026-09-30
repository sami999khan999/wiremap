import { type Container, Queue, QueueName, type Redis } from "../import.js";

export class DigestSchedule {
  private static readonly JOB_ID = "digest-daily";

  // 07:00 UTC. One hour for every tenant is deliberately the starting point: a per-tenant
  // hour is a column on the organization, and it is a follow-up rather than a default.
  private static readonly PATTERN = "0 7 * * *";

  public constructor(
    private readonly container: Container,
    private readonly connection: Redis,
  ) {}

  public async register(): Promise<void> {
    const queue = new Queue(QueueName.NOTIFICATION, { connection: this.connection });

    try {
      await queue.add(
        "digest-fanout",
        {},
        {
          repeat: { pattern: DigestSchedule.PATTERN },
          jobId: DigestSchedule.JOB_ID,
          // One failed fan-out at 07:00 would otherwise be every tenant's digest, gone.
          attempts: 5,
          backoff: { type: "exponential", delay: 60_000 },
          removeOnComplete: 10,
          removeOnFail: 100,
        },
      );

      this.container.logger.emit("queue.schedule.registered", {
        queue: QueueName.NOTIFICATION,
        jobId: DigestSchedule.JOB_ID,
      });
    } finally {
      await queue.close();
    }
  }
}
