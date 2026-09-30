import {
  index,
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

// A row means hidden and no row means shown, so the table holds only what somebody chose.
// Cosmetic: nothing reads it to decide what anyone may do, and it is never audited.
export const widgetPreferences = pgTable(
  "widget_preferences",
  {
    id: uuid("id").notNull(),
    organizationId: uuid("organization_id").$type<OrganizationId>().notNull(),
    // Null is the org default an admin set for everyone; a value is one person's own choice.
    userId: uuid("user_id").$type<UserId>(),
    // A string, not a key: a row can outlive the widget it names, and reads as `unregistered`.
    widget: text("widget").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // The tenant is the partition key, so it is in the primary key.
    primaryKey({ columns: [t.id, t.organizationId] }),
    // Two, split on the null: NULLs are distinct, so one index over a nullable `user_id`
    // would let an org default be hidden twice and enforce nothing for it.
    uniqueIndex("widget_preferences_user_uq")
      .on(t.organizationId, t.userId, t.widget)
      .where(sql`${t.userId} is not null`),
    uniqueIndex("widget_preferences_default_uq")
      .on(t.organizationId, t.widget)
      .where(sql`${t.userId} is null`),
    index("widget_preferences_user_fk_idx").on(t.userId),
  ],
);
