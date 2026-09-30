import {
  AnalyticsConsumer,
  EmbeddingConsumer,
  MailConsumer,
  MaintenanceConsumer,
  NotificationConsumer,
  OutboxConsumer,
} from "../consumer/index.js";
import { Env } from "../env.js";
import { type Container, QueueName, type RedisConnection, type Worker } from "../import.js";
import {
  CleanupSchedule,
  DigestSchedule,
  OrphansSchedule,
  OutboxDrainSchedule,
  PartitionsSchedule,
  ProjectionSchedule,
  ReconcileSchedule,
  RetentionSchedule,
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
    this.workers.push(
      new EmbeddingConsumer(
        this.container,
        this.redis.queueClient(),
        Env.embeddingConcurrency,
      ).start(),
    );

    // Unconditional, and the reason is in `.env.example`: every mail in this system is a
    // job, so a stopped worker is a sign-up whose verification link never arrives.
    this.workers.push(
      new MailConsumer(
        this.container,
        this.redis.queueClient(),
        Env.mailConcurrency,
        Env.mailRatePerMinute,
      ).start(),
    );

    // Before the schedules register, and before the drain in particular: a repeatable
    // job that fires the instant it lands needs somewhere to run.
    this.workers.push(
      new OutboxConsumer(this.container, this.redis.queueClient(), Env.eventConcurrency).start(),
    );

    this.workers.push(
      new NotificationConsumer(
        this.container,
        this.redis.queueClient(),
        Env.notificationConcurrency,
      ).start(),
    );

    // Before the schedules register, so an entry that fires the instant it lands has
    // somewhere to run. See docs/reference/schedules.md.
    this.workers.push(
      new MaintenanceConsumer(
        this.container,
        this.redis.queueClient(),
        Env.maintenanceConcurrency,
      ).start(),
    );

    // The branch is the point: without a ClickHouse config no consumer starts and no
    // schedule registers. See docs/reference/consumers.md.
    if (this.container.hasProjector) {
      this.workers.push(
        new AnalyticsConsumer(
          this.container,
          this.redis.queueClient(),
          Env.analyticsConcurrency,
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

    if (this.container.hasProjector) {
      await new ProjectionSchedule(this.container, this.redis.queueClient()).register();
      await new ReconcileSchedule(this.container, this.redis.queueClient()).register();
    }

    this.warnIfOversubscribed();

    this.container.logger.emit("process.started", {
      service: "worker",
      // The only difference on the wire between a worker running the analytics pipeline
      // and one built without a store to project into.
      consumers: this.workers.length,
    });
  }

  // Off the workers that actually started, never the consumers in the tree: without a
  // ClickHouse config the analytics consumer is not running and must not be counted.
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
