import { type Container, Queue, QueueName, type Redis } from "../import.js";

export class CleanupSchedule {
  // Fixed, which is what makes registration idempotent: without it every deploy adds a
  // copy and the nightly job runs eleven times by Friday.
  private static readonly JOB_ID = "cleanup-daily";
  private static readonly PATTERN = "0 3 * * *";

  public constructor(
    private readonly container: Container,
    private readonly connection: Redis,
  ) {}

  public async register(): Promise<void> {
    const queue = new Queue(QueueName.MAINTENANCE, { connection: this.connection });

    try {
      await queue.add(
        "cleanup",
        {},
        {
          repeat: { pattern: CleanupSchedule.PATTERN },
          jobId: CleanupSchedule.JOB_ID,
          removeOnComplete: 10,
          removeOnFail: 100,
        },
      );

      this.container.logger.emit("queue.schedule.registered", {
        queue: QueueName.MAINTENANCE,
        jobId: CleanupSchedule.JOB_ID,
      });
    } finally {
      // Only to publish the repeatable entry: left open it holds a second connection for
      // the life of the process.
      await queue.close();
    }
  }
}
