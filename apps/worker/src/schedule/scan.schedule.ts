import { type Container, Queue, QueueName, type Redis } from "../import.js";

// The two hourly scan jobs the dispatcher's cron runs in production: the stale-scan sweep
// and the schedule. One repeatable job each, so a restart never doubles them.
export class ScanSchedule {
  private static readonly EVERY_MS = 60 * 60 * 1_000;
  private static readonly JOBS = ["scan-sweep", "scan-schedule"] as const;

  public constructor(
    private readonly container: Container,
    private readonly connection: Redis,
  ) {}

  public async register(): Promise<void> {
    const queue = new Queue(QueueName.MAINTENANCE, { connection: this.connection });
    try {
      for (const name of ScanSchedule.JOBS) {
        await queue.add(
          name,
          {},
          {
            repeat: { every: ScanSchedule.EVERY_MS },
            jobId: name,
            removeOnComplete: 10,
            removeOnFail: 100,
          },
        );
        this.container.logger.emit("queue.schedule.registered", {
          queue: QueueName.MAINTENANCE,
          jobId: name,
        });
      }
    } finally {
      await queue.close();
    }
  }
}
