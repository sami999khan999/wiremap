import { z } from "../import.js";

// What the browser receives, so the union is closed and the client's routing table is
// total over it: a name with no route is a compile error rather than a dropped frame.
const eventName = z.enum([
  "member.changed",
  "notification.created",
  "conversation.changed",
  "conversation.read",
  "message.sent",
  "message.edited",
  "message.deleted",
]);

export type RealtimeEventName = z.infer<typeof eventName>;

export class RealtimeContract {
  private constructor() {}

  // No `organizationId` on the wire. The stream is opened by a resolved principal, so the
  // tenant is the session's by construction — putting it here invites trusting it.
  public static readonly message = z.discriminatedUnion("kind", [
    z.object({
      kind: z.literal("event"),
      id: z.uuid(),
      name: eventName,
      at: z.coerce.date(),
      // Ids a client may dedupe or narrow a refetch by, never data to render. Unknown keys
      // are stripped, so a publisher one deploy ahead still parses.
      payload: z.object({
        conversationId: z.uuid().optional(),
        messageId: z.uuid().optional(),
        kind: z.string().optional(),
      }),
    }),
    // A resume the replay log cannot serve, or a reader that fell behind. The client
    // refetches what it subscribes to rather than trusting a gap.
    z.object({ kind: z.literal("resync"), id: z.uuid() }),
    // Its own variant rather than an `event`: it invalidates nothing, expires on its
    // own, and a routing table that had to skip it would be a table with a hole.
    z.object({
      kind: z.literal("typing"),
      id: z.uuid(),
      conversationId: z.uuid(),
      userId: z.uuid(),
      at: z.coerce.date(),
    }),
  ]);

  public static readonly eventName = eventName;
}

export type RealtimeMessage = z.infer<typeof RealtimeContract.message>;
