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
  uuid,
} from "../../import.js";

// Declared as an ordinary table so the query builder types it; the generated DDL is
// hand-edited to `PARTITION BY RANGE (occurred_at)` before it is applied.
export const outboxEvent = pgTable(
  "outbox_event",
  {
    id: uuid("id").notNull(),
    // The one key whose cascade was doing real work: this table is `local` and has no
    // tenant level, so `DeleteOrganizationUseCase` sweeps it by hand — decision `24.1`.
    organizationId: uuid("organization_id").$type<OrganizationId>().notNull(),
    // Deliberately not a foreign key, for the reason `activity_log` gives: the fact
    // outlives the actor, and a cascade would erase it when it matters most.
    actorId: uuid("actor_id").$type<UserId>().notNull(),
    name: text("name").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    // Null until the drain has handed the row to the queue. It is the claim marker and
    // the retention key, and nothing is unique over it.
    publishedAt: timestamp("published_at", { withTimezone: true }),
    // Set while a drain relays the row, so another replica skips it; a drain that dies
    // mid-relay frees it when this passes.
    claimedUntil: timestamp("claimed_until", { withTimezone: true }),
  },
  (t) => [
    // Postgres requires the partition key in the primary key. `Uuid.v7()` is
    // time-ordered, so the key and the partition column still increase together.
    primaryKey({ columns: [t.id, t.occurredAt] }),
    // The drain's keyset, and cross-tenant by design: the worker drains everything, and
    // a tenant-leading index here would make it scan every partition per organization.
    index("outbox_event_pending_idx").on(t.occurredAt, t.id).where(sql`published_at is null`),
    // The sweep's. Partial too, so the index holds only what retention will look at.
    index("outbox_event_published_idx").on(t.publishedAt).where(sql`published_at is not null`),
    index("outbox_event_org_idx").on(t.organizationId, t.occurredAt),
  ],
);
