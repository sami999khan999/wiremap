import { CapabilitySet, type DomainEvent, type DomainEventName } from "../import.js";
import { Principal } from "../primitive/index.js";
import { EventSubscriber } from "../subscriber/index.js";
import type { DeliverNotificationUseCase } from "./deliver-notification.use-case.js";
import { NotificationPolicy } from "./notification.policy.js";

// Its `events` list *is* the policy table's keys, so a row added there is delivered with
// no second edit — and a row for an event nobody publishes is caught by a spec.
export class NotificationSubscriber extends EventSubscriber {
  public readonly name = "notification";
  public readonly events: readonly DomainEventName[] = NotificationPolicy.events();

  public constructor(private readonly deliver: DeliverNotificationUseCase) {
    super();
  }

  // Idempotent through the `(event_id, user_id, kind)` unique index rather than by
  // checking first: a second handler running concurrently would pass that check too.
  public async handle(event: DomainEvent): Promise<void> {
    // Built from the event, never handed the original actor: their permissions were
    // resolved at request time and the work is not being done on their behalf.
    const system = Principal.system(event.organizationId, event.actorId, CapabilitySet.empty());

    await this.deliver.execute(system, event);
  }
}
