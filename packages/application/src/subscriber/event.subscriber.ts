import type { DomainEvent, DomainEventName } from "../import.js";

// One per durable reaction to a fact. It receives the event, never an actor: a subscriber
// that needs a principal builds one from `event.organizationId`.
export abstract class EventSubscriber {
  public abstract readonly name: string;
  public abstract readonly events: readonly DomainEventName[];

  // **Idempotent on `event.id`.** Delivery is at-least-once, so a duplicate must be a
  // no-op rather than a second effect — and it may throw, which is that job's retry.
  public abstract handle(event: DomainEvent): Promise<void>;
}
