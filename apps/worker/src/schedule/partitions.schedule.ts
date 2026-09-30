import { type Container, Queue, QueueName, type Redis } from "../import.js";

// The deadline the first migrations wrote is no longer the only thing standing between
// this system and a failed insert: `runOnce()` recovers the runway at every boot.
export class PartitionsSchedule {
  private static readonly JOB_ID = "partitions-monthly";
  // A fixed id, so two replicas booting together enqueue one job rather than two.
  private static readonly BOOT_JOB_ID = "partitions-boot";
  // 02:00, ahead of the cleanup: a sweep that runs while the current month has no
  // partition fails on a table it cannot write to.
  private static readonly PATTERN = "0 2 1 * *";

  public constructor(
    private readonly container: Container,
    private readonly connection: Redis,
  ) {}

  // Not a repeat entry: one job, now, deduped by id. A worker that has been down since
  // before the first of the month gets its runway back on the way up.
  public async runOnce(): Promise<void> {
    const queue = new Queue(QueueName.MAINTENANCE, { connection: this.connection });

    try {
      await queue.add(
        "partitions",
        {},
        {
          jobId: PartitionsSchedule.BOOT_JOB_ID,
          removeOnComplete: true,
          // `true`, never a count: BullMQ ignores an `add` whose id is still in the failed
          // set, so one boot with Postgres down disabled the recovery for good (`CR.17`).
          removeOnFail: true,
        },
      );
    } finally {
      await queue.close();
    }
  }

  public async register(): Promise<void> {
    const queue = new Queue(QueueName.MAINTENANCE, { connection: this.connection });

    try {
      await queue.add(
        "partitions",
        {},
        {
          repeat: { pattern: PartitionsSchedule.PATTERN },
          jobId: PartitionsSchedule.JOB_ID,
          removeOnComplete: 10,
          removeOnFail: 100,
        },
      );

      this.container.logger.emit("queue.schedule.registered", {
        queue: QueueName.MAINTENANCE,
        jobId: PartitionsSchedule.JOB_ID,
      });
    } finally {
      await queue.close();
    }
  }
}
