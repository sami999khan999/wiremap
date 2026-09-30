import { type Container, Queue, QueueName, type Redis } from "../import.js";

// Keeps the pool of pre-seeded tenants full — `PF.3`. A full pool costs one count; an
// empty one costs nothing but speed, because the founder then seeds inline.
export class SparesSchedule {
  private static readonly JOB_ID = "spares-topup";
  // Five minutes: a pool of twenty drains only under a burst of signups, and a burst
  // longer than that falls back to the inline seed rather than failing.
  private static readonly EVERY_MS = 5 * 60 * 1_000;

  public constructor(
    private readonly container: Container,
    private readonly connection: Redis,
  ) {}

  public async register(): Promise<void> {
    const queue = new Queue(QueueName.MAINTENANCE, { connection: this.connection });

    try {
      await queue.add(
        "spares",
        {},
        {
          repeat: { every: SparesSchedule.EVERY_MS },
          jobId: SparesSchedule.JOB_ID,
          removeOnComplete: 10,
          removeOnFail: 100,
        },
      );

      this.container.logger.emit("queue.schedule.registered", {
        queue: QueueName.MAINTENANCE,
        jobId: SparesSchedule.JOB_ID,
      });
    } finally {
      await queue.close();
    }
  }
}
