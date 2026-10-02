import { DomainEvents, QueueName } from "../import.js";
import { QueueConsumer } from "./queue.consumer.js";
import type { QueueJob } from "./queue-job.js";

interface DeliverJobData {
  readonly subscriber: string;
  readonly event: unknown;
}

// A batch per call, and a bounded number of calls per run. Unbounded, a backlog would
// hold the worker in one job while the repeatable schedule piled up behind it.
const BATCH_SIZE = 100;
const MAX_BATCHES_PER_RUN = 20;

// Sixty seconds. Anything under a second is normal for a one-second drain; a minute
// behind means the drain is not running rather than that it is busy.
const LAG_THRESHOLD_MS = 60_000;

// The window we *ask* for. The real one is seconds: the drain's repeat job trims this
// queue's shared completed set to ten every second. See apps/worker/docs/reference/consumers.md.
const DELIVERY_RETENTION_SECONDS = 86_400;

export class OutboxConsumer extends QueueConsumer {
  public readonly queue = QueueName.EVENT;

  // Beside the base lines, not instead: one is the countable signal, this one names
  // which subscriber is stuck on which event.
  public override failed(job: QueueJob, error: unknown): void {
    super.failed(job, error);
    if (job.name !== "deliver") return;
    const data = job.data as DeliverJobData;
    this.container.logger.emit("outbox.delivery.failed", {
      subscriber: data.subscriber,
      event: OutboxConsumer.nameOf(data.event),
    });
  }

  public async handle(job: QueueJob): Promise<void> {
    switch (job.name) {
      case "drain":
        return this.drain();
      case "deliver":
        return this.deliver(job.data as DeliverJobData);
      default:
        throw new Error(`Unknown event job: ${job.name}`);
    }
  }

  // `outbox_event` is on every node and the relay is not, so the drain is per node.
  // `SKIP LOCKED` still shares each node between replicas; the loop adds no coordinator.
  private async drain(): Promise<void> {
    let events = 0;
    let jobs = 0;

    await this.container.eachShard(async () => {
      // The batch budget is per node, not per run: a busy node must not spend the
      // budget the node after it needs, and a run is a second long either way.
      for (let batch = 0; batch < MAX_BATCHES_PER_RUN; batch += 1) {
        const drained = await this.container.outbox.drain(BATCH_SIZE, async (claimed) => {
          jobs += await this.fanOut(claimed);
        });

        events += drained;
        // A short batch means this node's outbox is empty; the next tick is a second away.
        if (drained < BATCH_SIZE) break;
      }
    });

    this.container.logger.emit("outbox.drain.completed", { events, jobs });
    await this.reportLag();
  }

  // One job per (subscriber, event), from the registry. An event nobody listens for
  // becomes no jobs at all and is still marked published.
  private async fanOut(events: readonly { id: string; name: string }[]): Promise<number> {
    const subscriptions = this.container.subscribers.subscriptions();
    let published = 0;

    for (const event of events) {
      for (const subscriber of subscriptions.get(event.name as never) ?? []) {
        await this.container.queue.publish(
          QueueName.EVENT,
          { subscriber, event },
          {
            name: "deliver",
            // Numbered, not absent. A job with no priority goes on the plain wait list,
            // which `moveToActive` drains *before* it looks at the prioritized set.
            priority: 10,
            // No `:` — BullMQ keys on this and rejects the job at publish time.
            jobId: `${subscriber}_${event.id}`,
            // About three hours of doubling retries. The row is already marked published, so
            // a delivery that runs out of attempts is only recoverable by replay.
            attempts: 12,
            removeOnCompleteAgeSeconds: DELIVERY_RETENTION_SECONDS,
          },
        );
        published += 1;
      }
    }

    return published;
  }

  private async deliver(data: DeliverJobData): Promise<void> {
    // Parsed rather than trusted: the job crossed Redis as JSON, and the envelope is
    // what turns it back into a typed event with a payload matching its name.
    const event = DomainEvents.parse(data.event);

    // Placed on the event's own tenant: a subscriber that writes notifications is
    // writing a routed table, and the drain that queued this job placed nothing.
    await this.placed(event.organizationId, () =>
      // Let it throw. That is this delivery's retry and no other subscriber's, which
      // is the whole reason one event becomes one job per subscriber.
      this.container.subscribers.get(data.subscriber).handle(event),
    );
  }

  // Without this, a drain that has stopped running is silent: "no events published" and
  // "no events to publish" produce the same line.
  private async reportLag(): Promise<void> {
    const pending: Date[] = [];

    // The worst node, not the first: one line a run stays one line, and a lag reported
    // as the healthiest node's is a lag nobody sees.
    await this.container.eachShard(async () => {
      const at = await this.container.outbox.oldestPendingAt();
      if (at) pending.push(at);
    });

    const oldest = pending.reduce<Date | null>(
      (worst, at) => (worst === null || at < worst ? at : worst),
      null,
    );
    if (!oldest) return;

    const ageMs = this.container.clock.now().getTime() - oldest.getTime();
    if (ageMs < LAG_THRESHOLD_MS) return;

    this.container.logger.emit("outbox.drain.lagged", { oldestAgeMs: ageMs });
  }

  private static nameOf(event: unknown): string {
    if (typeof event !== "object" || event === null) return "unknown";
    const name = (event as { name?: unknown }).name;
    return typeof name === "string" ? name : "unknown";
  }
}
