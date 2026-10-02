import { type OrganizationId, QueueName } from "../import.js";
import { QueueConsumer } from "./queue.consumer.js";
import type { QueueJob } from "./queue-job.js";
import { SystemPrincipal } from "./system-principal.js";

interface DigestJobData {
  readonly organizationId: string;
  readonly day: string;
}

// Tenants per catalog page, and per batch of digest jobs enqueued in one round trip.
const TENANT_PAGE = 500;

export class NotificationConsumer extends QueueConsumer {
  public readonly queue = QueueName.NOTIFICATION;

  public async handle(job: QueueJob): Promise<void> {
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
  // one organization must not stop the others.
  private async fanOut(): Promise<void> {
    const day = NotificationConsumer.dayOf(this.container.clock.now());
    let organizations = 0;

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
              // Tenant plus day: a schedule that fires twice produces the same id, and
              // one morning's digest is sent once.
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
    await this.placed(data.organizationId, () =>
      this.container.notification.sendDigest.execute(SystemPrincipal.platform(), {
        organizationId: data.organizationId as OrganizationId,
        day: data.day,
      }),
    );
  }

  // UTC, and from the clock rather than the payload: a redelivered fan-out covers the
  // same day rather than one relative to the retry.
  private static dayOf(now: Date): string {
    return now.toISOString().slice(0, 10);
  }
}
