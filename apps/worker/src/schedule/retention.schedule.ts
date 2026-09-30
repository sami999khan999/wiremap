import { type Container, Queue, QueueName, type Redis } from "../import.js";

// The daily converger. A bucket call after the commit can fail and a rule deleted in a
// console is drift nothing else notices. See docs/reference/schedules.md.
export class RetentionSchedule {
  private static readonly JOB_ID = "retention-daily";
  // 03:30, between the cleanup and the reconcile: it touches no partition, so it wants
  // only to be somewhere the two monthly jobs are not.
  private static readonly PATTERN = "30 3 * * *";

  public constructor(
    private readonly container: Container,
    private readonly connection: Redis,
  ) {}

  public async register(): Promise<void> {
    const queue = new Queue(QueueName.MAINTENANCE, { connection: this.connection });

    try {
      await queue.add(
        "retention",
        {},
        {
          repeat: { pattern: RetentionSchedule.PATTERN },
          jobId: RetentionSchedule.JOB_ID,
          removeOnComplete: 10,
          removeOnFail: 100,
        },
      );

      this.container.logger.emit("queue.schedule.registered", {
        queue: QueueName.MAINTENANCE,
        jobId: RetentionSchedule.JOB_ID,
      });
    } finally {
      await queue.close();
    }
  }
}
