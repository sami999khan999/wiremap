import {
  boolean,
  check,
  index,
  integer,
  type OrganizationId,
  pgTable,
  primaryKey,
  smallint,
  sql,
  text,
  timestamp,
  uuid,
} from "../../import.js";
import { plans } from "./rbac.schema.js";

// **Global, and deliberately so.** A partition spans every tenant, so a per-tenant row
// here would describe something the storage engine cannot do.

// An absent row is the code default — `PartitionedTable.ALL` — which is what makes an
// empty table behave exactly as the deploy before it did.
export const retentionPolicy = pgTable(
  "retention_policy",
  {
    // `postgres` or `clickhouse`. Two stores with two different meanings of "retention",
    // and one table because the screen edits them side by side.
    store: text("store", { enum: ["postgres", "clickhouse"] }).notNull(),
    // Never from data: validated against `PartitionedTable.NAMES` in the use-case, which
    // is the same closed union every DDL path inlines.
    tableName: text("table_name").notNull(),
    // Months kept in the hot store. At least one: zero would drop the current month,
    // which is the one being written to.
    hotMonths: integer("hot_months").notNull(),
    // Months kept in cold storage after that. Null is "never expires", which is a
    // different statement from zero — zero deletes the object as soon as it lands.
    coldMonths: integer("cold_months"),
    // `drop` skips the archive step entirely. It is here because a table of transport
    // rows may genuinely not be worth the bytes, and the screen says what it costs.
    coldMode: text("cold_mode", { enum: ["archive", "drop"] })
      .notNull()
      .default("archive"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.store, t.tableName] }),
    // In the database as well as in the use-case. The use-case is the message a person
    // reads; this is what holds when a row is written by hand at 3am.
    check("retention_policy_hot_months_ck", sql`${t.hotMonths} >= 1`),
    check("retention_policy_cold_months_ck", sql`${t.coldMonths} is null or ${t.coldMonths} >= 0`),
  ],
);

// **One row, forever.** `check (id = 1)` is what makes that a database guarantee rather
// than a convention: a second row would be a second deployment-wide answer.
export const platformPolicy = pgTable(
  "platform_policy",
  {
    id: smallint("id").primaryKey(),
    // A pause, not a power switch — decision 12. Off stops the consumer projecting and
    // nothing else: the connection stays, and the TTL is still converged nightly.
    projectionEnabled: boolean("projection_enabled").notNull().default(true),
    // Off by default, which is the safe direction: a replica read that is stale is a
    // correctness bug, and turning it on is a decision someone makes.
    replicaReadsEnabled: boolean("replica_reads_enabled").notNull().default(false),
    // How long a moved tenant's rows stay on the node it left. **Null is not zero**: it
    // means "use the deployment's own default", the way an absent retention row does.
    moveGraceDays: smallint("move_grace_days"),
    // What a new signup lands on. The column default on `organizations` only places the
    // orgs that existed when the column was added; the founders read this one.
    defaultPlanKey: text("default_plan_key")
      .notNull()
      .default("unlimited")
      .references(() => plans.key),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("platform_policy_singleton_ck", sql`${t.id} = 1`),
    // One row, so this serves nothing a scan would not. §18 asks it of every foreign key.
    index("platform_policy_default_plan_idx").on(t.defaultPlanKey),
  ],
);

// One row per activity action, and an absent row is "projected, with the default TTL".
// Cross-tenant by construction: the projection is one deployment-wide decision.
export const projectionPolicy = pgTable(
  "projection_policy",
  {
    // Never from data: validated against `ActivityActions.isKnown` in the use-case, and
    // the same closed union the TTL expression interpolates.
    action: text("action").primaryKey(),
    projected: boolean("projected").notNull().default(true),
    // Null is "the default clause covers it". A number here is a `DELETE WHERE action =`
    // clause of its own, which is what lets one action be kept longer than the rest.
    ttlMonths: integer("ttl_months"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("projection_policy_ttl_months_ck", sql`${t.ttlMonths} is null or ${t.ttlMonths} >= 1`),
  ],
);

// Per tenant, and it **leads with the tenant** — so no §9 exemption, unlike the global
// table above. Expressible only because a tenant's month is its own partition.
export const tenantRetentionPolicy = pgTable(
  "tenant_retention_policy",
  {
    // No foreign key to `organizations`, for the reason the archive index gives: this
    // is swept by the delete path rather than cascaded, so the two stay in one order.
    organizationId: uuid("organization_id").$type<OrganizationId>().notNull(),
    tableName: text("table_name").notNull(),
    hotMonths: integer("hot_months").notNull(),
    coldMonths: integer("cold_months"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.organizationId, t.tableName] }),
    check("tenant_retention_policy_hot_months_ck", sql`${t.hotMonths} >= 1`),
    check(
      "tenant_retention_policy_cold_months_ck",
      sql`${t.coldMonths} is null or ${t.coldMonths} >= 0`,
    ),
  ],
);
