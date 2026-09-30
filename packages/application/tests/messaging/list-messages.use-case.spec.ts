import { describe, expect, it } from "vitest";
import type { ConversationRepository } from "../../src/messaging/conversation.repository.js";
import { ConversationAccess } from "../../src/messaging/conversation-access.js";
import { ListMessagesUseCase } from "../../src/messaging/list-messages.use-case.js";
import type { MessageQuery, MessageRepository } from "../../src/messaging/message.repository.js";
import {
  authorizer,
  CONVERSATION,
  conversation,
  membershipFrom,
  NOW,
  principal,
} from "./messaging-harness.js";

const build = (lastMessageAt: Date | null) => {
  const queries: MessageQuery[] = [];
  const messages = {
    list: (_org: unknown, query: MessageQuery) => {
      queries.push(query);
      return Promise.resolve({ items: [], olderCursor: null });
    },
  } as unknown as MessageRepository;
  const access = new ConversationAccess({
    findMembership: membershipFrom(() => Promise.resolve(conversation({ lastMessageAt }))),
  } as unknown as ConversationRepository);

  return { queries, useCase: new ListMessagesUseCase(authorizer, access, messages) };
};

describe("ListMessagesUseCase", () => {
  // The newest message's time is the first page's ceiling, which is what lets it skip the
  // months above it — `messages` is never retired, so there are always more of them.
  it("bounds the read by the conversation's newest message", async () => {
    const { queries, useCase } = build(NOW);

    await useCase.execute(principal(), { conversationId: CONVERSATION, limit: 30 });

    expect(queries[0]?.upTo).toEqual(NOW);
  });

  it("answers an empty page for a conversation with no messages, without a query", async () => {
    const { queries, useCase } = build(null);

    const page = await useCase.execute(principal(), { conversationId: CONVERSATION, limit: 30 });

    expect(page).toEqual({ items: [], olderCursor: null });
    expect(queries).toEqual([]);
  });
});
