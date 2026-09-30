import { type DomainEvent, type DomainEventName, Uuid } from "../import.js";
import type { RealtimePublisher } from "../port/index.js";
import { RealtimeChannels } from "../primitive/index.js";
import { EventSubscriber } from "../subscriber/index.js";

const EVENTS: readonly DomainEventName[] = [
  "member.invited",
  "member.joined",
  "member.role.changed",
];

// The first subscriber, and the one that proves the pipe: commit → drain → queue →
// subscriber → Redis → the browser. It writes nothing, so it needs no new table.
export class MemberRealtimeSubscriber extends EventSubscriber {
  public readonly name = "member-realtime";
  public readonly events = EVENTS;

  public constructor(private readonly realtime: RealtimePublisher) {
    super();
  }

  // Idempotent because it is a publish and nothing else: the same event handled twice
  // sends the same "something changed" frame twice, and the client refetches once.
  public async handle(event: DomainEvent): Promise<void> {
    for (const userId of MemberRealtimeSubscriber.audience(event)) {
      await this.realtime.publish(RealtimeChannels.user(event.organizationId, userId), {
        kind: "event",
        // Not `event.id`: one domain event fans out to several frames, and a client
        // deduping by frame id would drop all but the first.
        id: Uuid.v7(),
        name: "member.changed",
        at: event.occurredAt,
        // Compact on purpose. The frame says a refetch is due; it is not the data, and a
        // client that read it as data would be reading a snapshot it cannot authorise.
        payload: {},
      });
    }
  }

  // The actor always, so their other tabs update, plus the member the change was about.
  // No fan-out to the whole organization: that is the write amplification §6 warns of.
  private static audience(event: DomainEvent): readonly string[] {
    const subject = MemberRealtimeSubscriber.subjectOf(event);
    return subject && subject !== event.actorId ? [event.actorId, subject] : [event.actorId];
  }

  // Narrowed by naming the two, not by excluding one: the union has other members now,
  // and an `!== "member.invited"` test would have gone on compiling and reading nothing.
  private static subjectOf(event: DomainEvent): string | null {
    if (event.name === "member.joined" || event.name === "member.role.changed") {
      return event.payload.userId;
    }

    return null;
  }
}
