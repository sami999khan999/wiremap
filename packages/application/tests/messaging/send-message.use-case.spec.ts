import type { MessageId } from "@loadbearing/contracts";
import { FixedClock } from "@loadbearing/core";
import { describe, expect, it } from "vitest";
import type { ConversationRepository } from "../../src/messaging/conversation.repository.js";
import { ConversationAccess } from "../../src/messaging/conversation-access.js";
import type {
  MessageRecord,
  MessageRepository,
  NewMessage,
} from "../../src/messaging/message.repository.js";
import { SendMessageUseCase } from "../../src/messaging/send-message.use-case.js";
import type {
  CacheStore,
  DomainEventPublisher,
  RealtimePublisher,
  UnitOfWork,
} from "../../src/port/index.js";
import {
  authorizer,
  CONVERSATION,
  CountingUnitOfWork,
  conversation,
  GRACE,
  membershipFrom,
  message,
  NOW,
  ORG,
  OUTSIDER,
  principal,
  RecordingEvents,
  RecordingRealtime,
} from "./messaging-harness.js";

class Conversations {
  public touched = 0;

  public findById = () => Promise.resolve(conversation());
  public findMembership = membershipFrom(() => this.findById());
  public touch = () => {
    this.touched += 1;
    return Promise.resolve();
  };
}

// Keyed by id, because the dedupe's whole claim is that a retry is handed back the row
// the first attempt wrote rather than a second copy of it.
class Messages {
  public readonly saved: NewMessage[] = [];
  private readonly rows = new Map<string, MessageRecord>();

  public save = (input: NewMessage) => {
    this.saved.push(input);
    const row = message({
      id: input.id,
      body: input.body,
      clientId: input.clientId,
      createdAt: input.createdAt,
    });
    this.rows.set(input.id, row);
    return Promise.resolve(row);
  };

  public findById = (_org: unknown, _conversation: unknown, id: MessageId) =>
    Promise.resolve(this.rows.get(id) ?? null);
}

// The one behaviour under test: `setIfAbsent` writes only when the key is absent and
// says which happened. Real Redis evaluates `NX` on the server.
class Cache {
  public readonly entries = new Map<string, unknown>();

  public get = <T>(key: string) => Promise.resolve((this.entries.get(key) as T) ?? null);

  public set = <T>(key: string, value: T) => {
    this.entries.set(key, value);
    return Promise.resolve();
  };

  public setIfAbsent = <T>(key: string, value: T) => {
    if (this.entries.has(key)) return Promise.resolve(false);
    this.entries.set(key, value);
    return Promise.resolve(true);
  };

  public delete = (key: string) => {
    this.entries.delete(key);
    return Promise.resolve();
  };

  public deletePrefix = () => Promise.resolve();
}

const build = (
  conversations = new Conversations(),
  messages = new Messages(),
  cache = new Cache(),
) => {
  const events = new RecordingEvents();
  const realtime = new RecordingRealtime();
  const unitOfWork = new CountingUnitOfWork();
  const repo = conversations as unknown as ConversationRepository;

  return {
    conversations,
    messages,
    cache,
    events,
    realtime,
    unitOfWork,
    useCase: new SendMessageUseCase(
      authorizer,
      new ConversationAccess(repo),
      repo,
      messages as unknown as MessageRepository,
      events as unknown as DomainEventPublisher,
      realtime as unknown as RealtimePublisher,
      unitOfWork as unknown as UnitOfWork,
      cache as unknown as CacheStore,
      new FixedClock(NOW),
    ),
  };
};

const input = { conversationId: CONVERSATION, body: "hello", clientId: message().clientId };

const dedupeKey = `message:client:${ORG}:${CONVERSATION}:${input.clientId}`;

describe("SendMessageUseCase", () => {
  // One save, one touch, one event — the write shape the whole slice's cost rests on.
  // A second statement per send is a second statement per message, forever.
  it("writes once, touches once and publishes one event", async () => {
    const harness = build();

    await harness.useCase.execute(principal(), input);

    expect(harness.messages.saved).toHaveLength(1);
    expect(harness.conversations.touched).toBe(1);
    expect(harness.events.published.map((event) => event.name)).toEqual(["message.sent"]);
    expect(harness.unitOfWork.calls).toBe(1);
  });

  // The fast path: after the commit, on the conversation channel, not fanned out per
  // member. The durable path publishes the same frame from the subscriber.
  it("publishes the fast-path frame on the conversation channel", async () => {
    const harness = build();

    await harness.useCase.execute(principal(), input);

    expect(harness.realtime.frames).toHaveLength(1);
    expect(harness.realtime.frames[0]?.channel).toContain(":conversation:");
  });

  // Membership, not the permission. A colleague who may send messages in general is
  // still not in this room.
  it("refuses a sender who is not a member", async () => {
    const harness = build();

    await expect(harness.useCase.execute(principal(OUTSIDER), input)).rejects.toThrow("FORBIDDEN");
    expect(harness.messages.saved).toEqual([]);
  });

  // `PF.1` dropped the key into `conversations`, so this refusal is now the only one:
  // nothing below the use-case would reject a message for a conversation that is gone.
  it("refuses a conversation that does not exist, before anything is written", async () => {
    const conversations = new Conversations();
    conversations.findById = () =>
      Promise.resolve(null as unknown as ReturnType<typeof conversation>);
    const harness = build(conversations);

    await expect(harness.useCase.execute(principal(), input)).rejects.toThrow("FORBIDDEN");
    expect(harness.messages.saved).toEqual([]);
    expect(harness.events.published).toEqual([]);
    expect(harness.cache.entries.size).toBe(0);
  });

  it("refuses a member who cannot send", async () => {
    const harness = build();
    const reader = principal(GRACE, ["messaging.conversation.read"]);

    await expect(harness.useCase.execute(reader, input)).rejects.toThrow("FORBIDDEN");
  });

  // No `activity.record`: chat volume is not an audit trail, and the outbox row is the
  // durable fact. Asserted because adding one is the easy mistake.
  it("carries the message id and its partition hint in the event", async () => {
    const harness = build();

    await harness.useCase.execute(principal(), input);
    const [event] = harness.events.published;

    expect(event?.payload).toMatchObject({
      conversationId: CONVERSATION,
      messageId: harness.messages.saved[0]?.id,
      createdAt: NOW,
    });
  });
});

// The dedupe left Postgres when `messages` took a month level: a unique index there has
// to carry `created_at`, which a retry never reproduces. See reference/messaging.md.
describe("SendMessageUseCase, the send dedupe", () => {
  it("claims the client id under a key scoped to the conversation", async () => {
    const harness = build();

    await harness.useCase.execute(principal(), input);

    expect([...harness.cache.entries.keys()]).toEqual([dedupeKey]);
  });

  // Indistinguishable from the first attempt, which is what `DO UPDATE … RETURNING`
  // bought before: the same row back, and nothing written a second time.
  it("hands a retry the row the first attempt wrote", async () => {
    const harness = build();

    const first = await harness.useCase.execute(principal(), input);
    const retry = await harness.useCase.execute(principal(), input);

    expect(retry).toEqual(first);
    expect(harness.messages.saved).toHaveLength(1);
    expect(harness.conversations.touched).toBe(1);
    expect(harness.events.published).toHaveLength(1);
    expect(harness.realtime.frames).toHaveLength(1);
  });

  // The first attempt set the key and then rolled back, so the claim names a row that is
  // not there. A minute ago, which is what separates that from one still writing.
  it("sends as new when the claim names a row that was never written", async () => {
    const harness = build();
    harness.cache.entries.set(dedupeKey, {
      id: "018f8c00-0000-7000-8000-0000000000de",
      createdAt: new Date(NOW.getTime() - 60_000).toISOString(),
    });

    const sent = await harness.useCase.execute(principal(), input);

    expect(harness.messages.saved).toHaveLength(1);
    expect(sent.id).toBe(harness.messages.saved[0]?.id);
    // And the claim now names the row that exists, so the *next* retry is deduped
    // rather than writing a third message.
    expect(harness.cache.entries.get(dedupeKey)).toMatchObject({ id: sent.id });
  });

  // `R.36`. The retry arrives while the first attempt's transaction is still open, so
  // the claim is held and `findById` cannot see the row it has already written.
  it("refuses a retry that arrives while the first attempt is still writing", async () => {
    const harness = build();
    harness.cache.entries.set(dedupeKey, {
      id: "018f8c00-0000-7000-8000-0000000000de",
      createdAt: NOW.toISOString(),
    });

    await expect(harness.useCase.execute(principal(), input)).rejects.toThrow("CONFLICT");

    // Nothing written, and the claim untouched: taking it over is what produced the
    // second row once the first transaction finally committed.
    expect(harness.messages.saved).toEqual([]);
    expect(harness.cache.entries.get(dedupeKey)).toMatchObject({
      id: "018f8c00-0000-7000-8000-0000000000de",
    });
  });
});
