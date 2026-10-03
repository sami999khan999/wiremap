import { type DomainEvent, type DomainEventName, WEBHOOK_EVENTS } from "../import.js";
import type { QueuePublisher } from "../port/index.js";
import { QueueName } from "../primitive/index.js";
import { EventSubscriber } from "../subscriber/index.js";
import type { WebhookJob } from "./deliver-webhook.use-case.js";
import type { WebhookRepository } from "./webhook.repository.js";

// Turns an event into one delivery job per webhook that wants it. Each job retries on its
// own, so one dead endpoint never holds back the others or this event's other subscribers.
export class WebhookSubscriber extends EventSubscriber {
  public static readonly ATTEMPTS = 8;
  public readonly name = "webhook";
  public readonly events: readonly DomainEventName[] = WEBHOOK_EVENTS;

  public constructor(
    private readonly webhooks: WebhookRepository,
    private readonly queue: QueuePublisher,
  ) {
    super();
  }

  public async handle(event: DomainEvent): Promise<void> {
    const projectId = (event.payload as { readonly projectId?: string }).projectId ?? null;
    const wanted = (await this.webhooks.list(event.organizationId)).filter(
      (webhook) =>
        !webhook.disabledAt &&
        webhook.events.includes(event.name as (typeof WEBHOOK_EVENTS)[number]) &&
        (webhook.projectId === null || webhook.projectId === projectId),
    );
    if (wanted.length === 0) return;

    await this.queue.publishMany<WebhookJob>(
      QueueName.WEBHOOK,
      wanted.map((webhook) => ({
        payload: {
          organizationId: event.organizationId,
          webhookId: webhook.id,
          event: {
            id: event.id,
            name: event.name,
            organizationId: event.organizationId,
            occurredAt: event.occurredAt,
            payload: event.payload,
          },
        },
        // A redelivered event queues nothing new: the id is the event and the webhook.
        options: { jobId: `${event.id}-${webhook.id}`, attempts: WebhookSubscriber.ATTEMPTS },
      })),
    );
  }
}
