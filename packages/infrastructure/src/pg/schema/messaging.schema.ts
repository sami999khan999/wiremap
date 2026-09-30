import {
  type ConversationId,
  index,
  type MessageId,
  type OrganizationId,
  pgTable,
  primaryKey,
  sql,
  text,
  timestamp,
  type UserId,
  uniqueIndex,
  uuid,
} from "../../import.js";

// Partitioned by tenant and by nothing else: it grows with the tenant's people rather
// than with its activity, so a month level would be partitions holding nothing.
export const conversations = pgTable(
  "conversations",
  {
    id: uuid("id").$type<ConversationId>().notNull(),
    // No foreign key to `organizations`: it is on the catalog and this table is routed,
    // and Postgres enforces no key across two databases. See decision `24.1`.
    organizationId: uuid("organization_id").$type<OrganizationId>().notNull(),
    kind: text("kind").notNull(),
    // Null for a direct conversation, which the client titles from the other member.
    title: text("title"),
    // `<lowerId>_<higherId>`, and null for a channel. What makes opening the same DM
    // twice return the same row rather than a second one.
    directKey: text("direct_key"),
    createdBy: uuid("created_by").$type<UserId>().notNull(),
    // Milliseconds, like `messages.created_at`: `KeysetCursor` encodes milliseconds, and a
    // microsecond sort key skipped the rows inside the truncated window (`CR.31`).
    createdAt: timestamp("created_at", { withTimezone: true, precision: 3 }).notNull().defaultNow(),
    // Denormalised onto the conversation because it is the list's sort key: looked up
    // per row it would be a correlated subquery on every page.
    lastMessageAt: timestamp("last_message_at", { withTimezone: true }),
    lastMessageId: uuid("last_message_id").$type<MessageId>(),
  },
  (t) => [
    // The tenant is the partition key, so it is in the primary key — and the composite
    // is what the two foreign keys below have to name.
    primaryKey({ columns: [t.id, t.organizationId] }),
    // Partial, because NULLs are distinct in a unique index and a channel would
    // otherwise be unconstrained against every other channel. Tenant-leading, per §17.
    uniqueIndex("conversations_direct_uq")
      .on(t.organizationId, t.directKey)
      .where(sql`direct_key is not null`),
    // Coalesced, because `last_message_at` is null until the first message and a null
    // in the keyset's row constructor ends the walk. The list's ORDER BY matches.
    index("conversations_recent_idx").on(
      t.organizationId,
      sql`coalesce(${t.lastMessageAt}, ${t.createdAt}) desc`,
      t.id.desc(),
    ),
  ],
);

export const conversationMembers = pgTable(
  "conversation_members",
  {
    id: uuid("id").notNull(),
    // Routed, so no key to the catalog. The nightly orphan pass is what notices a row
    // whose tenant is gone — see decision `24.1`.
    organizationId: uuid("organization_id").$type<OrganizationId>().notNull(),
    // No key to `conversations` since `PF.1`: every insert runs `assertMember` first, and
    // the key made each signup's attach lock `conversations` — see docs/reference/partitions.md.
    conversationId: uuid("conversation_id").$type<ConversationId>().notNull(),
    // No key to `users` either, and that one was the expensive half: the cascade issued
    // a scan of every tenant partition on the node — see docs/reference/fan-out.md.
    userId: uuid("user_id").$type<UserId>().notNull(),
    role: text("role").notNull(),
    joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
    // The **only** unread state. There is no counter column: the count is computed from
    // this, capped, so nothing can drift. See application/docs/reference/messaging.md.
    lastReadAt: timestamp("last_read_at", { withTimezone: true }),
    lastReadMessageId: uuid("last_read_message_id").$type<MessageId>(),
    mutedAt: timestamp("muted_at", { withTimezone: true }),
  },
  (t) => [
    primaryKey({ columns: [t.id, t.organizationId] }),
    uniqueIndex("conversation_members_uq").on(t.organizationId, t.conversationId, t.userId),
    // "Which conversations am I in", which is the list query's driving side.
    index("conversation_members_mine_idx").on(t.organizationId, t.userId, t.lastReadAt),
    index("conversation_members_conversation_fk_idx").on(t.conversationId),
    index("conversation_members_user_fk_idx").on(t.userId),
  ],
);

// Two levels, `LIST (organization_id)` then `RANGE (created_at)`. The send dedupe that
// used to keep it unpartitioned is a Redis key now — see application/docs/reference/messaging.md.
export const messages = pgTable(
  "messages",
  {
    id: uuid("id").$type<MessageId>().notNull(),
    // Routed, so no key to the catalog — decision `24.1`.
    organizationId: uuid("organization_id").$type<OrganizationId>().notNull(),
    // No key, for the reason `conversation_members` gives. The nightly orphan pass counts.
    conversationId: uuid("conversation_id").$type<ConversationId>().notNull(),
    // No foreign key. A message outlives its author's account the way the audit trail
    // outlives its actor: deleting a person must not rewrite a conversation.
    authorId: uuid("author_id").$type<UserId>().notNull(),
    // The client's own key. It is no longer indexed: the dedupe it used to enforce is a
    // Redis `SET … NX`, because a unique index here cannot survive the month level.
    clientId: uuid("client_id").notNull(),
    body: text("body").notNull(),
    editedAt: timestamp("edited_at", { withTimezone: true }),
    // Soft: the row keeps its place so the conversation keeps its shape and the keyset
    // cursor over it stays stable. The body is blanked, not the row.
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    // Milliseconds, not the default microseconds: every caller hands this value back as a
    // predicate. See application/docs/reference/messaging.md.
    createdAt: timestamp("created_at", { withTimezone: true, precision: 3 }).notNull().defaultNow(),
  },
  (t) => [
    // Both partition keys, and `id` first so the key still reads as the row's identity.
    primaryKey({ columns: [t.id, t.organizationId, t.createdAt] }),
    // The keyset, in the exact order the backwards page asks for.
    index("messages_keyset_idx").on(
      t.organizationId,
      t.conversationId,
      t.createdAt.desc(),
      t.id.desc(),
    ),
    index("messages_conversation_fk_idx").on(t.conversationId),
  ],
);
