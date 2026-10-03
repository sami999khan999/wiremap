import { BullMqQueueConsumer, type BullMqQueueOptions } from "../consumer/index.js";
import { Env } from "../env.js";
import {
  ConsumerRegistry,
  type Container,
  QueueName,
  type RedisConnection,
  type Worker,
} from "../import.js";
import {
  CleanupSchedule,
  DigestSchedule,
  OrphansSchedule,
  OutboxDrainSchedule,
  PartitionsSchedule,
  RetentionSchedule,
  ScanSchedule,
  SparesSchedule,
} from "../schedule/index.js";

export class WorkerBootstrap {
  private readonly workers: Worker[] = [];
  private draining: Promise<void> | null = null;

  public constructor(
    private readonly container: Container,
    private readonly redis: RedisConnection,
  ) {}

  public async start(): Promise<void> {
    const registry = new ConsumerRegistry(this.container);

    // Every consumer starts before the schedules register: a repeatable job that fires
    // the instant it lands needs somewhere to run.
    for (const [queue, options] of WorkerBootstrap.queues()) {
      this.workers.push(
        new BullMqQueueConsumer(
          this.container,
          registry,
          this.redis.queueClient(),
          queue,
          options,
        ).start(),
      );
    }

    // Once at boot, before the schedules: the monthly cron only helps a worker that was
    // awake on the first, and the runway running out is every write in the system failing.
    await new PartitionsSchedule(this.container, this.redis.queueClient()).runOnce();

    await new OutboxDrainSchedule(this.container, this.redis.queueClient()).register();
    await new DigestSchedule(this.container, this.redis.queueClient()).register();
    await new PartitionsSchedule(this.container, this.redis.queueClient()).register();
    await new CleanupSchedule(this.container, this.redis.queueClient()).register();
    await new RetentionSchedule(this.container, this.redis.queueClient()).register();
    await new OrphansSchedule(this.container, this.redis.queueClient()).register();
    await new SparesSchedule(this.container, this.redis.queueClient()).register();
    await new ScanSchedule(this.container, this.redis.queueClient()).register();

    this.warnIfOversubscribed();

    this.container.logger.emit("process.started", {
      service: "worker",
      consumers: this.workers.length,
    });
  }

  // Mail is unconditional, and the reason is in `.env.example`: every mail in this
  // system is a job, so a stopped worker is a sign-up whose verification link never arrives.
  private static queues(): readonly (readonly [string, BullMqQueueOptions])[] {
    return [
      [QueueName.EMBEDDING, { concurrency: Env.embeddingConcurrency }],
      [
        QueueName.MAIL,
        {
          concurrency: Env.mailConcurrency,
          limiter: { max: Env.mailRatePerMinute, duration: 60_000 },
        },
      ],
      [QueueName.EVENT, { concurrency: Env.eventConcurrency }],
      [QueueName.NOTIFICATION, { concurrency: Env.notificationConcurrency }],
      // Five minutes, not BullMQ's 30 s: a runway pass logged nothing for its first
      // half-minute, the lock expired, and the job ran a second time.
      [QueueName.MAINTENANCE, { concurrency: Env.maintenanceConcurrency, lockDuration: 300_000 }],
      // One at a time: a dispatch is one call to GitHub, and nothing waits on it.
      [QueueName.SCAN, { concurrency: 1 }],
      // A few at once: each is a wait on someone else's server, bounded at ten seconds.
      [QueueName.WEBHOOK, { concurrency: 4 }],
    ];
  }

  // Off the workers that actually started, never the consumers in the tree: a consumer
  // that did not start holds no connection and must not be counted.
  private warnIfOversubscribed(): void {
    // `?? 1` is BullMQ's own default. Mail is left out: a send holds an SMTP socket, never
    // a database connection, and counting it made the defaults sum to the pool exactly.
    const concurrency = this.workers
      .filter((worker) => worker.name !== QueueName.MAIL)
      .reduce((sum, worker) => sum + (worker.opts.concurrency ?? 1), 0);
    const poolMax = Env.databasePoolMax;
    if (concurrency <= poolMax) return;

    // A warning, not a throw: a job that holds no connection is legitimate, and plenty
    // hold none. The operator wants this line before the queue stalls, not after.
    this.container.logger.emit("worker.pool.oversubscribed", { concurrency, poolMax });
  }

  // Idempotent, and a second signal *joins* the drain already running. Returning early
  // resolves at once, and `main.ts` exits on that — mid-close. See docs/reference/shutdown.md.
  public stop(signal: string): Promise<void> {
    this.draining ??= this.drain(signal);
    return this.draining;
  }

  private async drain(signal: string): Promise<void> {
    this.container.logger.emit("process.stopping", { service: "worker", signal });
    const startedAt = this.container.clock.now();

    // Handled before the race, never after: once the timeout has won, a rejection arriving
    // late has nowhere to land but `unhandledRejection`, which exits 1 over a clean drain.
    const closed = Promise.all(this.workers.map((w) => w.close())).then(
      () => undefined,
      (error: unknown) => {
        this.container.logger.failure(error, { service: "worker", phase: "close" });
      },
    );

    // `close()` drains; the race is the backstop, because a job that never returns must
    // not hold the process past the platform's SIGKILL timer.
    await Promise.race([closed, WorkerBootstrap.after(Env.shutdownTimeoutMs)]);

    await this.redis.close();

    this.container.logger.emit("process.stopped", {
      service: "worker",
      durationMs: this.container.clock.now().getTime() - startedAt.getTime(),
    });

    // Last, because everything closing above it may have had something to say.
    await this.container.dispose();
  }

  private static after(ms: number): Promise<void> {
    return new Promise((resolve) => {
      // Unreferenced, so a pending timer cannot keep the loop alive once every worker
      // has drained.
      setTimeout(resolve, ms).unref();
    });
  }
}
