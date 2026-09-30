import { z } from "../import.js";
import { Identifiers } from "../primitive/index.js";

// Past tense, always. The payload is what a subscriber needs and no more: never the
// message body, which would put a DM in the outbox table and in every consumer's reach.
export const messagingEvents = {
  "conversation.created": z.object({
    conversationId: Identifiers.conversationId,
    kind: z.enum(["direct", "channel"]),
  }),
  "conversation.member.added": z.object({
    conversationId: Identifiers.conversationId,
    userId: Identifiers.userId,
  }),
  "conversation.member.removed": z.object({
    conversationId: Identifiers.conversationId,
    userId: Identifiers.userId,
  }),
  "conversation.renamed": z.object({
    conversationId: Identifiers.conversationId,
  }),
  // No body. A subscriber that needs one reads the message, which is authorised; an
  // event that carried it would put every DM in a table with a different audience.
  "message.sent": z.object({
    conversationId: Identifiers.conversationId,
    messageId: Identifiers.messageId,
    // The partition hint every reader of this row needs to find the message again.
    createdAt: z.coerce.date(),
    // Carried so the notification policy can tell a DM from a channel without a second
    // query. A channel produces no bell item — that is the §6 amplification case.
    conversationKind: z.enum(["direct", "channel"]),
  }),
  "message.edited": z.object({
    conversationId: Identifiers.conversationId,
    messageId: Identifiers.messageId,
    createdAt: z.coerce.date(),
  }),
  "message.deleted": z.object({
    conversationId: Identifiers.conversationId,
    messageId: Identifiers.messageId,
    createdAt: z.coerce.date(),
  }),
} as const;
