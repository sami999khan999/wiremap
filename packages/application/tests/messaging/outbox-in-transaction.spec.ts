import type { OrganizationId, UserId } from "@loadbearing/contracts";
import { describe, expect, it } from "vitest";
import { AddConversationMemberUseCase } from "../../src/messaging/add-conversation-member.use-case.js";
import type {
  ConversationRecord,
  ConversationRepository,
} from "../../src/messaging/conversation.repository.js";
import { ConversationAccess } from "../../src/messaging/conversation-access.js";
import { DeleteMessageUseCase } from "../../src/messaging/delete-message.use-case.js";
import { EditMessageUseCase } from "../../src/messaging/edit-message.use-case.js";
import { LeaveConversationUseCase } from "../../src/messaging/leave-conversation.use-case.js";
import type { MessageRecord, MessageRepository } from "../../src/messaging/message.repository.js";
import { RemoveConversationMemberUseCase } from "../../src/messaging/remove-conversation-member.use-case.js";
import { RenameConversationUseCase } from "../../src/messaging/rename-conversation.use-case.js";
import type { DomainEventPublisher, UnitOfWork } from "../../src/port/index.js";
import { TenantMembershipReader } from "../../src/port/index.js";
import {
  ADA,
  authorizer,
  CONVERSATION,
  CountingUnitOfWork,
  GRACE,
  MESSAGE,
  membershipFrom,
  message,
  NOW,
  principal,
  RecordingEvents,
} from "./messaging-harness.js";

const OWNER = { userId: ADA, role: "owner" as const, joinedAt: NOW, lastReadAt: null };
const PLAIN = { userId: GRACE, role: "member" as const, joinedAt: NOW, lastReadAt: null };

const channel = (): ConversationRecord => ({
  id: CONVERSATION,
  kind: "channel",
  title: "general",
  createdBy: ADA,
  createdAt: NOW,
  lastMessageAt: null,
  lastMessageId: null,
  members: [OWNER, PLAIN],
});

class Conversations {
  public findByDirectKey = () => Promise.resolve(null);
  public findById = () => Promise.resolve(channel());
  public findMembership = membershipFrom(() => this.findById());
  public save = () => Promise.resolve(CONVERSATION);
  public saveMember = () => Promise.resolve();
  public deleteMember = () => Promise.resolve();
  public rename = () => Promise.resolve();
}

class Messages {
  public findById = (): Promise<MessageRecord> => Promise.resolve(message());
  public edit = (): Promise<MessageRecord> => Promise.resolve(message({ body: "after" }));
  public softDelete = () => Promise.resolve();
}

class Memberships extends TenantMembershipReader {
  public override isActiveMember(_org: OrganizationId, _userId: UserId): Promise<boolean> {
    return Promise.resolve(true);
  }

  public override activeMemberIds(
    _org: OrganizationId,
    userIds: readonly UserId[],
  ): Promise<ReadonlySet<UserId>> {
    return Promise.resolve(new Set(userIds));
  }
}

const clock = { now: () => NOW };

// One harness per case, because each use-case takes its own collaborators — what is
// shared is the question, which is whether the publish happened with a transaction open.
function parts() {
  const unitOfWork = new CountingUnitOfWork();
  const events = new RecordingEvents(unitOfWork);
  const conversations = new Conversations();
  const access = new ConversationAccess(conversations as unknown as ConversationRepository);

  return {
    unitOfWork,
    events,
    conversations: conversations as unknown as ConversationRepository,
    access,
    asWork: unitOfWork as unknown as UnitOfWork,
    asEvents: events as unknown as DomainEventPublisher,
  };
}

const manager = () =>
  principal(ADA, [
    "messaging.conversation.read",
    "messaging.conversation.manage",
    "messaging.message.update",
  ]);

// `send` has always written and published inside one transaction. These six did not, so
// the write could commit with no outbox row and no subscriber would ever hear of it.
describe("every messaging write publishes inside its transaction", () => {
  it("add member", async () => {
    const p = parts();
    const useCase = new AddConversationMemberUseCase(
      authorizer,
      p.access,
      p.conversations,
      p.asEvents,
      new Memberships(),
      p.asWork,
    );

    await useCase.execute(manager(), {
      conversationId: CONVERSATION,
      userId: "00000000-0000-7000-8000-0000000000ff" as UserId,
    });

    expect(p.events.inTransaction).toEqual([true]);
  });

  it("remove member", async () => {
    const p = parts();
    const useCase = new RemoveConversationMemberUseCase(
      authorizer,
      p.access,
      p.conversations,
      p.asEvents,
      p.asWork,
    );

    await useCase.execute(manager(), { conversationId: CONVERSATION, userId: GRACE });

    expect(p.events.inTransaction).toEqual([true]);
  });

  it("leave", async () => {
    const p = parts();
    const useCase = new LeaveConversationUseCase(
      authorizer,
      p.access,
      p.conversations,
      p.asEvents,
      p.asWork,
    );

    await useCase.execute(principal(GRACE, ["messaging.conversation.read"]), {
      conversationId: CONVERSATION,
    });

    expect(p.events.inTransaction).toEqual([true]);
  });

  it("rename", async () => {
    const p = parts();
    const useCase = new RenameConversationUseCase(
      authorizer,
      p.access,
      p.conversations,
      p.asEvents,
      p.asWork,
    );

    await useCase.execute(manager(), { conversationId: CONVERSATION, title: "renamed" });

    expect(p.events.inTransaction).toEqual([true]);
  });

  it("edit message", async () => {
    const p = parts();
    const messages = new Messages();
    const useCase = new EditMessageUseCase(
      authorizer,
      p.access,
      messages as unknown as MessageRepository,
      p.asEvents,
      clock,
      p.asWork,
    );

    await useCase.execute(manager(), {
      conversationId: CONVERSATION,
      messageId: MESSAGE,
      createdAt: NOW,
      body: "after",
    });

    expect(p.events.inTransaction).toEqual([true]);
  });

  it("delete message", async () => {
    const p = parts();
    const messages = new Messages();
    const useCase = new DeleteMessageUseCase(
      authorizer,
      p.access,
      messages as unknown as MessageRepository,
      p.asEvents,
      clock,
      p.asWork,
    );

    await useCase.execute(manager(), {
      conversationId: CONVERSATION,
      messageId: MESSAGE,
      createdAt: NOW,
    });

    expect(p.events.inTransaction).toEqual([true]);
  });
});
