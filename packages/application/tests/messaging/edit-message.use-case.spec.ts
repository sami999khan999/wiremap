import type { Clock } from "@loadbearing/core";
import { describe, expect, it } from "vitest";
import type { ConversationRepository } from "../../src/messaging/conversation.repository.js";
import { ConversationAccess } from "../../src/messaging/conversation-access.js";
import { DeleteMessageUseCase } from "../../src/messaging/delete-message.use-case.js";
import { EditMessageUseCase } from "../../src/messaging/edit-message.use-case.js";
import type { MessageRecord, MessageRepository } from "../../src/messaging/message.repository.js";
import { MessagingRules } from "../../src/messaging/messaging.rules.js";
import type { DomainEventPublisher, UnitOfWork } from "../../src/port/index.js";
import {
  authorizer,
  CONVERSATION,
  CountingUnitOfWork,
  conversation,
  GRACE,
  MESSAGE,
  membershipFrom,
  message,
  NOW,
  principal,
  RecordingEvents,
} from "./messaging-harness.js";

const clockAt = (at: Date): Clock => ({ now: () => at }) as Clock;

const conversations = {
  findById: () => Promise.resolve(conversation()),
  findMembership: membershipFrom(() => Promise.resolve(conversation())),
} as unknown as ConversationRepository;

class Messages {
  public deleted = 0;

  public constructor(private readonly row: MessageRecord | null) {}

  public findById = () => Promise.resolve(this.row);
  public edit = (_org: unknown, _id: unknown, _at: unknown, body: string) =>
    Promise.resolve(message({ body, editedAt: NOW }));
  public softDelete = () => {
    this.deleted += 1;
    return Promise.resolve();
  };
}

const editor = (row: MessageRecord | null, at = NOW) => {
  const messages = new Messages(row);
  const events = new RecordingEvents();
  return {
    messages,
    events,
    useCase: new EditMessageUseCase(
      authorizer,
      new ConversationAccess(conversations),
      messages as unknown as MessageRepository,
      events as unknown as DomainEventPublisher,
      clockAt(at),
      new CountingUnitOfWork() as unknown as UnitOfWork,
    ),
  };
};

const input = {
  conversationId: CONVERSATION,
  messageId: MESSAGE,
  createdAt: NOW,
  body: "corrected",
};

describe("EditMessageUseCase", () => {
  it("edits your own message inside the window", async () => {
    const harness = editor(message());

    await expect(harness.useCase.execute(principal(), input)).resolves.toMatchObject({
      body: "corrected",
    });
    expect(harness.events.published.map((event) => event.name)).toEqual(["message.edited"]);
  });

  // The window is what keeps a conversation a record of what was said, rather than a
  // document either party can rewrite after the fact.
  it("refuses your own message past the window", async () => {
    const late = new Date(NOW.getTime() + MessagingRules.EDIT_WINDOW_MS + 1);
    const harness = editor(message(), late);

    await expect(harness.useCase.execute(principal(), input)).rejects.toThrow("FORBIDDEN");
  });

  it("refuses somebody else's message inside the window", async () => {
    const harness = editor(message());

    await expect(harness.useCase.execute(principal(GRACE), input)).rejects.toThrow("FORBIDDEN");
  });

  // How a moderator reaches a message that is not theirs and not recent.
  it("allows a manager past both", async () => {
    const late = new Date(NOW.getTime() + MessagingRules.EDIT_WINDOW_MS + 1);
    const harness = editor(message(), late);
    const manager = principal(GRACE, [
      "messaging.conversation.read",
      "messaging.message.update",
      "messaging.conversation.manage",
    ]);

    await expect(harness.useCase.execute(manager, input)).resolves.toBeTruthy();
  });

  // The partition hint. A wrong value finds nothing rather than another row, which is
  // the only failure mode a hint may have.
  it("answers NOT_FOUND when the row is not where the hint says", async () => {
    const harness = editor(null);

    await expect(harness.useCase.execute(principal(), input)).rejects.toThrow("NOT_FOUND");
  });

  it("refuses to edit a deleted message", async () => {
    const harness = editor(message({ deleted: true, body: "" }));

    await expect(harness.useCase.execute(principal(), input)).rejects.toThrow("NOT_FOUND");
  });
});

const remover = (row: MessageRecord | null) => {
  const messages = new Messages(row);
  const events = new RecordingEvents();
  return {
    messages,
    events,
    useCase: new DeleteMessageUseCase(
      authorizer,
      new ConversationAccess(conversations),
      messages as unknown as MessageRepository,
      events as unknown as DomainEventPublisher,
      clockAt(NOW),
      new CountingUnitOfWork() as unknown as UnitOfWork,
    ),
  };
};

describe("DeleteMessageUseCase", () => {
  it("soft-deletes and publishes", async () => {
    const harness = remover(message());

    await harness.useCase.execute(principal(), {
      conversationId: CONVERSATION,
      messageId: MESSAGE,
      createdAt: NOW,
    });

    expect(harness.messages.deleted).toBe(1);
    expect(harness.events.published.map((event) => event.name)).toEqual(["message.deleted"]);
  });

  // A retried delete is the same intent. Failing it would show an error for work that
  // already succeeded.
  it("is a no-op on a message already deleted", async () => {
    const harness = remover(message({ deleted: true, body: "" }));

    await harness.useCase.execute(principal(), {
      conversationId: CONVERSATION,
      messageId: MESSAGE,
      createdAt: NOW,
    });

    expect(harness.messages.deleted).toBe(0);
    expect(harness.events.published).toEqual([]);
  });
});
