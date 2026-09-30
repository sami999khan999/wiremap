import { type Container, Queue, QueueName, type Redis } from "../import.js";

// The daily count check between the audit trail and the derived store, at 05:00 so it
// reads a window the archive job has finished with. See docs/reference/schedules.md.
export class ReconcileSchedule {
  private static readonly JOB_ID = "analytics-reconcile";
  private static readonly PATTERN = "0 5 * * *";

  public constructor(
    private readonly container: Container,
    private readonly connection: Redis,
  ) {}

  public async register(): Promise<void> {
    const queue = new Queue(QueueName.ANALYTICS, { connection: this.connection });

    try {
      await queue.add(
        "reconcile",
        {},
        {
          repeat: { pattern: ReconcileSchedule.PATTERN },
          jobId: ReconcileSchedule.JOB_ID,
          removeOnComplete: 10,
          removeOnFail: 100,
          attempts: 1,
        },
      );

      this.container.logger.emit("queue.schedule.registered", {
        queue: QueueName.ANALYTICS,
        jobId: ReconcileSchedule.JOB_ID,
      });
    } finally {
      await queue.close();
    }
  }
}
