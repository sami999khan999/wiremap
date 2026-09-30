import { type DomainEventInput, DomainEventPublisher, type Principal } from "../import.js";

export interface PublishedEvent {
  readonly organizationId: string;
  readonly actorId: string;
  readonly name: string;
  readonly payload: unknown;
}

// Records rather than writing. "Inviting a member publishes exactly one `member.invited`"
// is the assertion, and it needs neither Postgres nor a worker.
export class RecordingDomainEventPublisher extends DomainEventPublisher {
  private readonly events: PublishedEvent[] = [];

  public override publish(actor: Principal, event: DomainEventInput): Promise<void> {
    this.events.push({
      organizationId: actor.organizationId,
      actorId: actor.userId,
      name: event.name,
      payload: event.payload,
    });
    return Promise.resolve();
  }

  public published(): readonly PublishedEvent[] {
    return this.events;
  }

  public publishedNamed(name: string): readonly PublishedEvent[] {
    return this.events.filter((event) => event.name === name);
  }
}
