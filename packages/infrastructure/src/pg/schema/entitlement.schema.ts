import {
  index,
  type OrganizationId,
  pgTable,
  sql,
  text,
  timestamp,
  type UserId,
  uniqueIndex,
  uuid,
} from "../../import.js";
import { organizations } from "./rbac.schema.js";

// One org's departure from its plan: an `add` widens it (a trial is an expiring one), a
// `remove` narrows it and wins over the plan and any add. See entitlement-mask.md.
export const entitlementAdjustments = pgTable(
  "entitlement_adjustments",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .$type<OrganizationId>()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    permission: text("permission").notNull(),
    effect: text("effect", { enum: ["add", "remove"] }).notNull(),
    // Required: an adjustment nobody can explain is one nobody dares remove.
    reason: text("reason").notNull(),
    // Null is permanent. Past it the row is ignored at read time and swept by the worker.
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    // No foreign key: the audit trail names the actor, and a deleted admin must not take
    // the adjustment with them.
    createdBy: uuid("created_by").$type<UserId>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // One row per org and key: an add and a remove of the same key would be a contradiction.
    uniqueIndex("entitlement_adjustments_uq").on(t.organizationId, t.permission),
    // The sweep's read. Partial, because a permanent row is never a candidate.
    index("entitlement_adjustments_expiry_idx").on(t.expiresAt).where(sql`expires_at is not null`),
  ],
);

// The deployment-wide kill switch, for an incident. A row is a module switched off for
// every tenant; no row is on. Outside plan data on purpose: it overrides every plan.
export const disabledModules = pgTable("disabled_modules", {
  module: text("module").primaryKey(),
  reason: text("reason").notNull(),
  disabledBy: uuid("disabled_by").$type<UserId>(),
  disabledAt: timestamp("disabled_at", { withTimezone: true }).notNull().defaultNow(),
});
