import { type DomainEventName, DomainEvents } from "../import.js";
import type { EventSubscriber } from "./event.subscriber.js";

// Built once by `Container` from a frozen list. Everything it can reject, it rejects at
// construction: a wiring mistake is a startup crash rather than a lost event at 3am.
export class SubscriberRegistry {
  private readonly byName: ReadonlyMap<string, EventSubscriber>;
  private readonly byEvent: ReadonlyMap<DomainEventName, readonly string[]>;

  public constructor(subscribers: readonly EventSubscriber[]) {
    const byName = new Map<string, EventSubscriber>();
    const byEvent = new Map<DomainEventName, string[]>();

    for (const subscriber of subscribers) {
      // The name is half of every job id, so a duplicate would make two subscribers
      // deduplicate against each other and one of them would never run.
      if (byName.has(subscriber.name)) {
        throw new Error(`Duplicate subscriber name: ${subscriber.name}`);
      }
      byName.set(subscriber.name, subscriber);

      for (const event of subscriber.events) {
        // `isKnown` narrows to the union, so the failing branch narrows to `never` —
        // hence the widening before it reaches the message.
        if (!DomainEvents.isKnown(event)) {
          const unknown: string = event;
          throw new Error(`Subscriber ${subscriber.name} listens for unknown event: ${unknown}`);
        }
        byEvent.set(event, [...(byEvent.get(event) ?? []), subscriber.name]);
      }
    }

    this.byName = byName;
    this.byEvent = byEvent;
  }

  // What the drain reads to decide how many jobs one event becomes.
  public subscriptions(): ReadonlyMap<DomainEventName, readonly string[]> {
    return this.byEvent;
  }

  public get(name: string): EventSubscriber {
    const subscriber = this.byName.get(name);
    // A job naming a subscriber that no longer exists must be loud. Succeeding quietly
    // would drop the event and report success to the queue.
    if (!subscriber) throw new Error(`Unknown subscriber: ${name}`);
    return subscriber;
  }

  public names(): readonly string[] {
    return [...this.byName.keys()];
  }
}
