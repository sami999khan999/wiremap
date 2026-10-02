import {
  type DomainEventInput,
  type DomainEventName,
  DomainEventPublisher,
  type Logger,
  type Principal,
  QueueName,
  type QueuePublisher,
} from "../import.js";

// Long enough for the transaction that wrote the event to commit, and one drain per
// window however many events land in it.
const DRAIN_DELAY_MS = 5_000;

// Writes the event, then asks for a drain shortly after. On Cloudflare there is no
// one-second schedule, and an hourly backstop alone would leave notifications an hour late.
export class OutboxDrainPublisher extends DomainEventPublisher {
  public constructor(
    private readonly events: DomainEventPublisher,
    private readonly queue: QueuePublisher,
    private readonly logger: Logger,
    private readonly now: () => number = Date.now,
  ) {
    super();
  }

  public async publish<N extends DomainEventName>(
    actor: Principal,
    event: DomainEventInput<N>,
  ): Promise<void> {
    await this.events.publish(actor, event);

    // Never fails the caller's transaction: a lost request costs latency, because the
    // hourly backstop drains whatever it missed.
    const window = Math.floor(this.now() / DRAIN_DELAY_MS);
    try {
      await this.queue.publish(
        QueueName.EVENT,
        {},
        {
          name: "drain",
          delayMs: DRAIN_DELAY_MS,
          attempts: 3,
          onceWithin: { id: `drain_${window}`, seconds: Math.ceil(DRAIN_DELAY_MS / 1000) },
        },
      );
    } catch (error) {
      this.logger.failure(error, { queue: QueueName.EVENT, job: "drain" });
    }
  }
}
