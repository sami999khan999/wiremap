import { z } from "../import.js";
import { Identifiers, Keyset } from "../primitive/index.js";

// A DM is unique per pair and has no title; a channel has a title and a member list that
// changes. One table, because everything else about them is identical.
const kind = z.enum(["direct", "channel"]);

// Inside a conversation, not inside the organization. The person who opened a channel
// can rename it and remove people from it; a member cannot.
const memberRole = z.enum(["owner", "member"]);

const TITLE_MAX = 120;
// Enough for a group without becoming a fan-out problem on the first send. Past this a
// channel wants the summary path `data-and-scale.md` §6 describes.
const MEMBERS_MAX = 100;

export class ConversationContract {
  private constructor() {}

  public static readonly kind = kind;
  public static readonly memberRole = memberRole;

  public static readonly member = z.object({
    userId: Identifiers.userId,
    // Resolved on the catalog after the routed read, never joined to it. Null is a
    // member this tenant can no longer name, and the copy layer decides what to render.
    name: z.string().nullable(),
    role: memberRole,
    joinedAt: z.date(),
    // The reader's own position. Every other member's is deliberately absent: read
    // receipts across a channel are a per-member row nobody asked to publish.
    lastReadAt: z.date().nullable(),
  });

  public static readonly entity = z.object({
    id: Identifiers.conversationId,
    kind,
    // Null for a direct conversation, which the client titles from the other member.
    title: z.string().nullable(),
    createdBy: Identifiers.userId,
    createdAt: z.date(),
    // Null until the first message. It is also the list's sort key, which is why it is
    // on the conversation rather than looked up per row.
    lastMessageAt: z.date().nullable(),
    lastMessageId: Identifiers.messageId.nullable(),
    // The whole roster from `conversation.get`; a sample from `conversation.list`, the
    // reader always in it, since a list row needs a name and not the room (`CR.26`).
    members: z.array(ConversationContract.member).readonly(),
    // Computed per request from `last_read_at`, capped at 100 — there is no stored
    // counter to drift. See packages/application/docs/reference/messaging.md.
    unreadCount: z.number().int().nonnegative(),
  });

  public static readonly listQuery = Keyset.query;

  public static readonly get = z.object({ conversationId: Identifiers.conversationId });

  public static readonly create = z
    .object({
      kind,
      title: z.string().min(1).max(TITLE_MAX).optional(),
      // The actor is added by the use-case and must not be listed: a client that
      // included itself would make a two-person channel out of a DM request.
      memberIds: z.array(Identifiers.userId).min(1).max(MEMBERS_MAX),
    })
    // A direct conversation is exactly two people and has no name. Enforced here so the
    // use-case never has to decide what a titled DM would mean.
    .refine((input) => input.kind !== "direct" || input.memberIds.length === 1, {
      message: "VALIDATION_FAILED",
      path: ["memberIds"],
    })
    .refine((input) => input.kind !== "direct" || input.title === undefined, {
      message: "VALIDATION_FAILED",
      path: ["title"],
    });

  public static readonly rename = z.object({
    conversationId: Identifiers.conversationId,
    title: z.string().min(1).max(TITLE_MAX),
  });

  // One shape for add and remove: naming a person in a conversation is the same input
  // either way, and two identical schemas is two places for a field to be forgotten.
  public static readonly memberRef = z.object({
    conversationId: Identifiers.conversationId,
    userId: Identifiers.userId,
  });

  public static readonly leave = z.object({ conversationId: Identifiers.conversationId });

  // `createdAt` is the partition hint for the message, as everywhere else a partitioned
  // row is addressed. A wrong value is NOT_FOUND rather than a scan of every month.
  public static readonly markRead = z.object({
    conversationId: Identifiers.conversationId,
    messageId: Identifiers.messageId,
    createdAt: z.date(),
  });
}

export type ConversationDto = z.infer<typeof ConversationContract.entity>;
export type ConversationKind = z.infer<typeof kind>;
export type ConversationMemberDto = z.infer<typeof ConversationContract.member>;
export type ConversationMemberRole = z.infer<typeof memberRole>;
export type ListConversationsInput = z.infer<typeof ConversationContract.listQuery>;
export type CreateConversationInput = z.infer<typeof ConversationContract.create>;
export type RenameConversationInput = z.infer<typeof ConversationContract.rename>;
export type ConversationMemberInput = z.infer<typeof ConversationContract.memberRef>;
export type LeaveConversationInput = z.infer<typeof ConversationContract.leave>;
export type MarkConversationReadInput = z.infer<typeof ConversationContract.markRead>;
