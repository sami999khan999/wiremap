import { SystemPrincipal, withShard } from "../bootstrap/index.js";
import {
  type Container,
  type Job,
  type OrganizationId,
  QueueName,
  type Redis,
  Worker,
} from "../import.js";

interface DigestJobData {
  readonly organizationId: string;
  readonly day: string;
}

// Tenants per catalog page, and per batch of digest jobs enqueued in one round trip.
const TENANT_PAGE = 500;

export class NotificationConsumer {
  public constructor(
    private readonly container: Container,
    private readonly connection: Redis,
    private readonly concurrency: number,
  ) {}

  public start(): Worker {
    const worker = new Worker(QueueName.NOTIFICATION, async (job: Job) => this.handle(job), {
      connection: this.connection,
      concurrency: this.concurrency,
    });

    worker.on("failed", (job, error) => {
      this.container.logger.emit("queue.job.failed", {
        queue: QueueName.NOTIFICATION,
        jobId: job?.id ?? "unknown",
        attempt: job?.attemptsMade ?? 0,
      });

      this.container.logger.failure(error, {
        queue: QueueName.NOTIFICATION,
        jobId: job?.id ?? "unknown",
        attempt: job?.attemptsMade ?? 0,
      });
    });

    worker.on("stalled", (jobId) => {
      this.container.logger.emit("queue.job.stalled", { queue: QueueName.NOTIFICATION, jobId });
    });

    return worker;
  }

  public async handle(job: Job): Promise<void> {
    switch (job.name) {
      case "digest-fanout":
        return this.fanOut();
      case "digest":
        return this.digest(job.data as DigestJobData);
      default:
        throw new Error(`Unknown notification job: ${job.name}`);
    }
  }

  // One job per tenant rather than one job doing every tenant: a digest that fails for
  // one organization must not stop the other four thousand.
  private async fanOut(): Promise<void> {
    const day = NotificationConsumer.dayOf(this.container.clock.now());
    let organizations = 0;

    // Each node's tenants from the catalog, a page at a time. The old question — which
    // tenants have unread rows — scanned every tenant's partitions and ran out of locks.
    await this.container.eachShard(async (node) => {
      let after: OrganizationId | null = null;

      for (;;) {
        const page = await this.container.organizations.page(after, TENANT_PAGE, node);
        if (page.length === 0) break;

        // A tenant with nothing unread costs its digest job one pruned query and no mail.
        await this.container.queue.publishMany(
          QueueName.NOTIFICATION,
          page.map((organizationId) => ({
            payload: { organizationId, day },
            options: {
              name: "digest",
              // Tenant plus day. A schedule that fires twice, or a redelivered fan-out,
              // produces the same id and BullMQ sends one morning's digest.
              jobId: `digest_${organizationId}_${day}`,
              attempts: 3,
            },
          })),
        );
        organizations += page.length;

        after = page.at(-1) ?? null;
        if (page.length < TENANT_PAGE) break;
      }
    });

    this.container.logger.emit("notification.digest.completed", { organizations, day });
  }

  private async digest(data: DigestJobData): Promise<void> {
    // The fan-out placed nothing on this job beyond the tenant id, and the digest reads
    // routed tables: it is placed here, once, the same shape every per-tenant job takes.
    await withShard(this.container, data.organizationId, () =>
      this.container.notification.sendDigest.execute(SystemPrincipal.platform(), {
        organizationId: data.organizationId as OrganizationId,
        day: data.day,
      }),
    );
  }

  // UTC, and from the clock rather than the payload for the fan-out: a redelivered job
  // covers the same day rather than one relative to the retry.
  private static dayOf(now: Date): string {
    return now.toISOString().slice(0, 10);
  }
}
