import { type Container, Queue, QueueName, type Redis } from "../import.js";

// The nightly count `24.1` promised when it dropped the ten cross-shard foreign keys.
// A leaked row used to be impossible; it is now merely rare, and this is what notices.
export class OrphansSchedule {
  private static readonly JOB_ID = "orphans-daily";
  // 04:00, after the retention converger and before the reconcile. It reads partition
  // names and one index, so it wants only to be somewhere the DDL passes are not.
  private static readonly PATTERN = "0 4 * * *";

  public constructor(
    private readonly container: Container,
    private readonly connection: Redis,
  ) {}

  public async register(): Promise<void> {
    const queue = new Queue(QueueName.MAINTENANCE, { connection: this.connection });

    try {
      await queue.add(
        "orphans",
        {},
        {
          repeat: { pattern: OrphansSchedule.PATTERN },
          jobId: OrphansSchedule.JOB_ID,
          removeOnComplete: 10,
          removeOnFail: 100,
        },
      );

      this.container.logger.emit("queue.schedule.registered", {
        queue: QueueName.MAINTENANCE,
        jobId: OrphansSchedule.JOB_ID,
      });
    } finally {
      await queue.close();
    }
  }
}
