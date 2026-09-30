import {
  index,
  jsonb,
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

// Declared as an ordinary table so the query builder types it; the generated DDL is
// hand-edited to two levels — `LIST (organization_id)`, then `RANGE (created_at)`.
export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").notNull(),
    // Routed, so no key to the catalog — decision `24.1`. A tenant delete drops this
    // table's partitions, and the nightly orphan pass catches whatever that misses.
    organizationId: uuid("organization_id").$type<OrganizationId>().notNull(),
    // No key to `users` either. An inbox still has no reason to outlive the account,
    // but nothing deletes a user today and the cascade scanned every partition.
    userId: uuid("user_id").$type<UserId>().notNull(),
    // The outbox event that produced it. No foreign key: retention drops an event
    // months before it drops the notification, and a cascade would take the inbox too.
    eventId: uuid("event_id").notNull(),
    kind: text("kind").notNull(),
    category: text("category").notNull(),
    params: jsonb("params").$type<Record<string, string>>().notNull().default({}),
    link: text("link"),
    // What the row is about when that is narrower than the event — a conversation id.
    // Null for the rows whose subject is the event itself.
    subjectId: text("subject_id"),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Postgres requires **every** partition key in the primary key, and this table has
    // two levels. `Uuid.v7()` is time-ordered, so the key still increases with the month.
    primaryKey({ columns: [t.id, t.organizationId, t.createdAt] }),
    // The keyset, in the exact order the list's ORDER BY asks for.
    index("notifications_inbox_idx").on(
      t.organizationId,
      t.userId,
      t.createdAt.desc(),
      t.id.desc(),
    ),
    // The bell's count, partial so the index holds only what it will ever be asked for.
    index("notifications_unread_idx").on(t.organizationId, t.userId).where(sql`read_at is null`),
    // The idempotency key, and `createdAt` is in it because a partitioned table demands
    // the partition column — sound only because that value is the event's, not the clock's.
    uniqueIndex("notifications_dedupe_uq").on(
      t.organizationId,
      t.userId,
      t.eventId,
      t.kind,
      t.createdAt,
    ),
    // "Is there already an unread one of these about this thing." Partial, so it holds
    // only the rows the suppression check can ever match.
    index("notifications_subject_idx")
      .on(t.organizationId, t.userId, t.kind, t.subjectId)
      .where(sql`read_at is null and subject_id is not null`),
    index("notifications_user_fk_idx").on(t.userId),
  ],
);

// Partitioned by tenant and by nothing else: it is bounded by users × categories ×
// channels, so it grows with the tenant rather than with its activity.
export const notificationPreferences = pgTable(
  "notification_preferences",
  {
    id: uuid("id").notNull(),
    // Neither key crosses to the catalog any more — decision `24.1`.
    organizationId: uuid("organization_id").$type<OrganizationId>().notNull(),
    userId: uuid("user_id").$type<UserId>().notNull(),
    category: text("category").notNull(),
    channel: text("channel").notNull(),
    mode: text("mode").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // The tenant is a partition key, so it is in the primary key — the same rule the
    // month level imposes one table up, at the level this table has.
    primaryKey({ columns: [t.id, t.organizationId] }),
    // An absent row is the category's default from `NotificationPolicy`, so this table
    // holds only what somebody actually changed.
    uniqueIndex("notification_preferences_uq").on(
      t.organizationId,
      t.userId,
      t.category,
      t.channel,
    ),
    index("notification_preferences_user_fk_idx").on(t.userId),
  ],
);
