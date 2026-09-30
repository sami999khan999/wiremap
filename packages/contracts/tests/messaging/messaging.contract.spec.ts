import { describe, expect, it } from "vitest";
import {
  ConversationContract,
  type ConversationDto,
} from "../../src/messaging/conversation.contract.js";
import { ConversationEntity } from "../../src/messaging/conversation.entity.js";
import { MessageContract, type MessageDto } from "../../src/messaging/message.contract.js";
import { MessageEntity } from "../../src/messaging/message.entity.js";
import { Identifiers } from "../../src/primitive/index.js";

const ADA = Identifiers.userId.parse("018f8c00-0000-7000-8000-000000000011");
const GRACE = Identifiers.userId.parse("018f8c00-0000-7000-8000-000000000012");
const CONVERSATION = Identifiers.conversationId.parse("018f8c00-0000-7000-8000-0000000000c1");

const direct = (over: Partial<ConversationDto> = {}): ConversationDto => ({
  id: CONVERSATION,
  kind: "direct",
  title: null,
  createdBy: ADA,
  createdAt: new Date("2026-09-03T00:00:00Z"),
  lastMessageAt: null,
  lastMessageId: null,
  members: [
    {
      userId: ADA,
      name: "Ada Lovelace",
      role: "owner",
      joinedAt: new Date("2026-09-03T00:00:00Z"),
      lastReadAt: null,
    },
    {
      userId: GRACE,
      name: "Grace Hopper",
      role: "member",
      joinedAt: new Date("2026-09-03T00:00:00Z"),
      lastReadAt: null,
    },
  ],
  unreadCount: 0,
  ...over,
});

const message = (over: Partial<MessageDto> = {}): MessageDto => ({
  id: Identifiers.messageId.parse("018f8c00-0000-7000-8000-0000000000d1"),
  conversationId: CONVERSATION,
  authorId: ADA,
  clientId: "018f8c00-0000-7000-8000-0000000000e1",
  body: "hello",
  deleted: false,
  editedAt: null,
  createdAt: new Date("2026-09-03T00:00:00Z"),
  ...over,
});

describe("ConversationContract", () => {
  // A direct conversation is exactly two people and has no name, refused in the schema so
  // no use-case ever has to decide what a titled DM would mean.
  it("refuses a direct conversation with more than one other member", () => {
    const result = ConversationContract.create.safeParse({
      kind: "direct",
      memberIds: [GRACE, ADA],
    });

    expect(result.success).toBe(false);
  });

  it("refuses a titled direct conversation", () => {
    const result = ConversationContract.create.safeParse({
      kind: "direct",
      title: "Ada and Grace",
      memberIds: [GRACE],
    });

    expect(result.success).toBe(false);
  });

  it("accepts a titled channel with several members", () => {
    const result = ConversationContract.create.safeParse({
      kind: "channel",
      title: "Deployments",
      memberIds: [ADA, GRACE],
    });

    expect(result.success).toBe(true);
  });

  // A name, and nothing else beside it: every other member's read position stays off
  // the wire, and an email address on this DTO would be one spread away from it.
  it("carries a name and the reader's own read position, and no more", () => {
    const parsed = ConversationContract.member.parse({
      userId: ADA,
      name: "Ada Lovelace",
      role: "owner",
      joinedAt: new Date("2026-09-03T00:00:00Z"),
      lastReadAt: null,
    });

    expect(Object.keys(parsed).sort()).toEqual([
      "joinedAt",
      "lastReadAt",
      "name",
      "role",
      "userId",
    ]);
  });
});

describe("ConversationEntity", () => {
  it("finds the other member of a direct conversation", () => {
    expect(ConversationEntity.from(direct()).otherMember(ADA)?.userId).toBe(GRACE);
  });

  it("finds nobody for a channel, which titles itself", () => {
    const channel = direct({ kind: "channel", title: "Deployments" });

    expect(ConversationEntity.from(channel).otherMember(ADA)).toBeNull();
  });

  // The whole of `23.26b`: a direct conversation used to render "Direct message" on
  // every row, and the typing notice under it printed a uuid.
  it("titles a direct conversation after the other person", () => {
    expect(ConversationEntity.from(direct()).displayTitle(ADA)).toBe("Grace Hopper");
  });

  it("prefers a channel’s own title to any member", () => {
    const channel = direct({ kind: "channel", title: "Deployments" });

    expect(ConversationEntity.from(channel).displayTitle(ADA)).toBe("Deployments");
  });

  // Null rather than the id, so the caller renders copy. Returning the uuid here is the
  // defect wearing a different hat.
  it("titles nothing when the other member can no longer be named", () => {
    const nameless = direct({
      members: [
        {
          userId: ADA,
          name: "Ada Lovelace",
          role: "owner",
          joinedAt: new Date(),
          lastReadAt: null,
        },
        { userId: GRACE, name: null, role: "member", joinedAt: new Date(), lastReadAt: null },
      ],
    });

    expect(ConversationEntity.from(nameless).displayTitle(ADA)).toBeNull();
    expect(ConversationEntity.from(nameless).nameOf(GRACE)).toBeNull();
  });

  it("names a member by id, for an author line and a typing frame", () => {
    expect(ConversationEntity.from(direct()).nameOf(ADA)).toBe("Ada Lovelace");
    expect(ConversationEntity.from(direct()).nameOf("nobody")).toBeNull();
  });

  it("caps the badge rather than showing a number that is a lie", () => {
    expect(ConversationEntity.from(direct({ unreadCount: 4 })).badge).toBe("4");
    expect(ConversationEntity.from(direct({ unreadCount: 100 })).badge).toBe("99+");
    expect(ConversationEntity.from(direct()).badge).toBeNull();
  });

  it("finds the last owner, and only when there is exactly one", () => {
    expect(ConversationEntity.from(direct()).lastOwner).toBe(ADA);

    const twoOwners = direct({
      members: direct().members.map((member) => ({ ...member, role: "owner" as const })),
    });
    expect(ConversationEntity.from(twoOwners).lastOwner).toBeNull();
  });
});

describe("MessageContract", () => {
  it("refuses an empty body and one past the limit", () => {
    const base = { conversationId: CONVERSATION, clientId: message().clientId };

    expect(MessageContract.send.safeParse({ ...base, body: "" }).success).toBe(false);
    expect(MessageContract.send.safeParse({ ...base, body: "x".repeat(4_001) }).success).toBe(
      false,
    );
    expect(MessageContract.send.safeParse({ ...base, body: "x" }).success).toBe(true);
  });

  // The optimistic key and the dedupe key are the same field, so a client that omitted
  // it would get a row it cannot match to the one it drew.
  it("requires the client id on a send", () => {
    const result = MessageContract.send.safeParse({ conversationId: CONVERSATION, body: "hi" });

    expect(result.success).toBe(false);
  });

  it("pages backwards, with a cursor named for the direction it goes", () => {
    const parsed = MessageContract.page.parse({ items: [message()], olderCursor: null });

    expect(parsed.olderCursor).toBeNull();
    expect("nextCursor" in parsed).toBe(false);
  });
});

describe("MessageEntity", () => {
  it("keeps a deleted row in place but not renderable", () => {
    const deleted = MessageEntity.from(message({ deleted: true, body: "" }));

    expect(deleted.renderable).toBe(false);
    expect(deleted.id).toBe(message().id);
  });

  it("knows who wrote it", () => {
    expect(MessageEntity.from(message()).authoredBy(ADA)).toBe(true);
    expect(MessageEntity.from(message()).authoredBy(GRACE)).toBe(false);
  });
});
