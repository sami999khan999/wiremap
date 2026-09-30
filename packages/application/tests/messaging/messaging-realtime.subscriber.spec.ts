import type {
  ConversationId,
  DomainEvent,
  OrganizationId,
  RealtimeMessage,
  UserId,
} from "@loadbearing/contracts";
import { Identifiers } from "@loadbearing/contracts";
import { describe, expect, it } from "vitest";
import type { ConversationRepository } from "../../src/messaging/conversation.repository.js";
import { MessagingRealtimeSubscriber } from "../../src/messaging/messaging-realtime.subscriber.js";
import type { RealtimePublisher } from "../../src/port/index.js";
import type { RealtimeChannel } from "../../src/primitive/index.js";
import { CONVERSATION, NOW, ORG } from "./messaging-harness.js";

// Past the fan-out chunk, which is 500. A room that fits in one chunk cannot tell a
// chunked loop from a broken one.
const MEMBERS = 1_201;

const memberAt = (index: number): UserId =>
  Identifiers.userId.parse(`018f8c00-0000-7000-8000-${index.toString(16).padStart(12, "0")}`);

const members: readonly UserId[] = Array.from({ length: MEMBERS }, (_, index) => memberAt(index));

class RecordingPublisher implements RealtimePublisher {
  public readonly sent: { channel: RealtimeChannel; message: RealtimeMessage }[] = [];

  public publish(channel: RealtimeChannel, message: RealtimeMessage): Promise<void> {
    this.sent.push({ channel, message });
    return Promise.resolve();
  }
}

// Only `memberIds` is under test here; every other method belongs to a different spec.
class StubConversations implements Partial<ConversationRepository> {
  public calls = 0;

  public memberIds(
    _organizationId: OrganizationId,
    _conversationId: ConversationId,
    limit = members.length,
    after: UserId | null = null,
  ): Promise<readonly UserId[]> {
    this.calls += 1;
    const start = after === null ? 0 : members.indexOf(after) + 1;
    return Promise.resolve(members.slice(start, start + limit));
  }
}

const eventOf = (name: DomainEvent["name"]): DomainEvent =>
  ({
    id: "018f8c00-0000-7000-8000-0000000000e1",
    organizationId: ORG,
    name,
    actorId: memberAt(0),
    occurredAt: NOW,
    payload: { conversationId: CONVERSATION },
  }) as DomainEvent;

const harness = () => {
  const realtime = new RecordingPublisher();
  const conversations = new StubConversations();

  return {
    realtime,
    conversations,
    subscriber: new MessagingRealtimeSubscriber(
      realtime,
      conversations as unknown as ConversationRepository,
    ),
  };
};

describe("MessagingRealtimeSubscriber", () => {
  // The body rides the conversation channel and is published once. N members would be N
  // publishes of the same bytes.
  it("publishes the conversation frame once, whatever the room holds", async () => {
    const { subscriber, realtime } = harness();
    await subscriber.handle(eventOf("message.edited"));

    expect(realtime.sent).toHaveLength(1);
    expect(realtime.sent[0]?.channel).toContain(`conversation:${CONVERSATION}`);
    expect(realtime.sent[0]?.message).toMatchObject({ name: "message.edited" });
  });

  // The regression guard for the chunking: 1 201 members across three chunks, one frame
  // each, none dropped and none sent twice.
  it("reaches every member exactly once, across chunk boundaries", async () => {
    const { subscriber, realtime, conversations } = harness();
    await subscriber.handle(eventOf("message.sent"));

    const userFrames = realtime.sent.filter((frame) => frame.channel.includes(":user:"));
    const channels = new Set(userFrames.map((frame) => frame.channel));

    expect(userFrames).toHaveLength(MEMBERS);
    expect(channels.size).toBe(MEMBERS);
    // One read per page of a thousand, not one per chunk and not one for the whole room.
    expect(conversations.calls).toBe(2);
  });

  // Every frame carries its own id: one domain event becomes several, and a client
  // deduping by frame id would drop all but the first.
  it("gives every frame its own id", async () => {
    const { subscriber, realtime } = harness();
    await subscriber.handle(eventOf("message.sent"));

    const ids = new Set(
      realtime.sent.map((frame) => (frame.message.kind === "event" ? frame.message.id : "")),
    );

    expect(ids.size).toBe(realtime.sent.length);
  });

  // The rest are conversation-local, and cost nothing to anyone with the room closed.
  it("does not fan out for an event that only reorders nothing", async () => {
    const { subscriber, realtime, conversations } = harness();
    await subscriber.handle(eventOf("message.deleted"));

    expect(realtime.sent).toHaveLength(1);
    expect(conversations.calls).toBe(0);
  });

  // The client dedupes the request's fast-path frame against this one by `messageId`.
  it("carries the message id on a message frame", async () => {
    const { subscriber, realtime } = harness();
    const messageId = "018f8c00-0000-7000-8000-0000000000d1";
    await subscriber.handle({
      ...eventOf("message.edited"),
      payload: { conversationId: CONVERSATION, messageId, createdAt: NOW },
    } as DomainEvent);

    expect(realtime.sent[0]?.message).toMatchObject({
      payload: { conversationId: CONVERSATION, messageId },
    });
  });

  // So a member's tab refetches that one conversation, not the whole inbox.
  it("names the conversation on each member's frame", async () => {
    const { subscriber, realtime } = harness();
    await subscriber.handle(eventOf("message.sent"));

    const userFrame = realtime.sent.find((frame) => frame.channel.includes(":user:"));

    expect(userFrame?.message).toMatchObject({ payload: { conversationId: CONVERSATION } });
  });

  it("ignores an event with no conversation in its payload", async () => {
    const { subscriber, realtime } = harness();
    await subscriber.handle({
      id: "018f8c00-0000-7000-8000-0000000000e2",
      organizationId: ORG,
      name: "member.invited",
      actorId: memberAt(0),
      occurredAt: NOW,
      payload: {},
    } as unknown as DomainEvent);

    expect(realtime.sent).toEqual([]);
  });
});
