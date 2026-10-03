import {
  index,
  jsonb,
  pgTable,
  primaryKey,
  sql,
  text,
  timestamp,
  type UserId,
  uuid,
} from "../../import.js";

// Declared as an ordinary table so the query builder types it; the generated DDL is
// hand-edited to two levels — `LIST (organization_id)`, then `RANGE (occurred_at)`.
export const activityLog = pgTable(
  "activity_log",
  {
    id: uuid("id").notNull(),
    organizationId: uuid("organization_id").notNull(),
    // Deliberately *not* a foreign key: an audit row outlives the actor it names, and a
    // cascade would erase the trail of a deleted account when it matters most.
    actorId: uuid("actor_id").$type<UserId>().notNull(),
    action: text("action").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Postgres requires **every** partition key in the primary key, and this table has
    // two levels. `Uuid.v7()` is time-ordered, so the key still increases with the month.
    primaryKey({ columns: [t.id, t.organizationId, t.occurredAt] }),
    index("activity_log_org_time_idx").on(t.organizationId, t.occurredAt.desc()),
    // A project's activity feed reads the trail by the project its payload names.
    index("activity_log_project_idx").on(
      t.organizationId,
      sql`(${t.payload}->>'projectId')`,
      t.occurredAt.desc(),
    ),
    // The projection's keyset, read per tenant since `16.6`: the tenant level prunes to
    // one list partition and this index walks the months inside it.
    index("activity_log_replay_idx").on(t.occurredAt, t.id),
  ],
);
