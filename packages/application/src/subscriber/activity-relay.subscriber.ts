import type { DomainEvent, DomainEventName } from "../import.js";
import type { RelayedActivityStore } from "../port/index.js";
import { EventSubscriber } from "./event.subscriber.js";

const EVENTS: readonly DomainEventName[] = ["activity.recorded"];

// Writes the audit row a catalog transaction could not write where it belongs. The drain
// runs this placed on the event's tenant, so the row lands on that tenant's node.
export class ActivityRelaySubscriber extends EventSubscriber {
  public readonly name = "activity-relay";
  public readonly events = EVENTS;

  public constructor(private readonly store: RelayedActivityStore) {
    super();
  }

  // The event's own time, never the delivery's: the row says when the action happened,
  // and a redelivery of the same event writes nothing new.
  public async handle(event: DomainEvent): Promise<void> {
    if (event.name !== "activity.recorded") return;

    await this.store.save({
      id: event.payload.entryId,
      organizationId: event.organizationId,
      actorId: event.actorId,
      action: event.payload.action,
      payload: event.payload.payload,
      occurredAt: event.occurredAt,
    });
  }
}
