import { type Container, Queue, QueueName, type Redis } from "../import.js";

export class OutboxDrainSchedule {
  // Fixed, which is what makes registration idempotent: without it every deploy adds a
  // copy and the drain runs several times a second for no benefit.
  private static readonly JOB_ID = "outbox-drain";

  // Every second, which is the commit-to-delivery budget. The way to improve it later is
  // LISTEN/NOTIFY, not a shorter interval — the trigger is a measured budget under 500 ms.
  private static readonly EVERY_MS = 1_000;

  public constructor(
    private readonly container: Container,
    private readonly connection: Redis,
  ) {}

  public async register(): Promise<void> {
    const queue = new Queue(QueueName.EVENT, { connection: this.connection });

    try {
      await queue.add(
        "drain",
        {},
        {
          repeat: { every: OutboxDrainSchedule.EVERY_MS },
          jobId: OutboxDrainSchedule.JOB_ID,
          // Ahead of the deliveries it creates. A backlog of `deliver` jobs must not
          // starve the drain, or the outbox grows while the worker looks busy.
          priority: 1,
          // `true`, never a count: a count trims the queue's whole completed set every second,
          // which was the delivery jobs' dedupe window shrinking to seconds.
          removeOnComplete: true,
          removeOnFail: 100,
        },
      );

      this.container.logger.emit("queue.schedule.registered", {
        queue: QueueName.EVENT,
        jobId: OutboxDrainSchedule.JOB_ID,
      });
    } finally {
      await queue.close();
    }
  }
}
