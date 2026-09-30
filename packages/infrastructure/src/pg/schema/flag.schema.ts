import {
  boolean,
  index,
  type OrganizationId,
  pgTable,
  text,
  timestamp,
  type UserId,
  uniqueIndex,
  uuid,
} from "../../import.js";
import { organizations } from "./rbac.schema.js";

// Whether a flag the code declares is on for the whole deployment. **A missing row is
// off**, so a flag ships dark and a deploy that adds one changes nothing until someone acts.
export const featureFlags = pgTable("feature_flags", {
  // Never from data: validated against `FlagRegistry.isKnown` in the use-case. A row the
  // code no longer declares is an orphan the platform screen shows, not an error.
  key: text("key").primaryKey(),
  isEnabled: boolean("is_enabled").notNull().default(false),
  // No foreign key: the audit trail names the actor, and a deleted admin must not take
  // the switch's history with them.
  updatedBy: uuid("updated_by").$type<UserId>(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// The orgs a flag is on for while it is off for everyone else. Cascades from both sides:
// a deleted tenant or a deleted flag row takes its targets with it.
export const featureFlagOrganizations = pgTable(
  "feature_flag_organizations",
  {
    organizationId: uuid("organization_id")
      .$type<OrganizationId>()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    flagKey: text("flag_key")
      .notNull()
      .references(() => featureFlags.key, { onDelete: "cascade" }),
    createdBy: uuid("created_by").$type<UserId>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Leads with the tenant (§17), and serves the cascade from `organizations` (§18).
    uniqueIndex("feature_flag_organizations_uq").on(t.organizationId, t.flagKey),
    // For the cascade from `feature_flags`, which the key above cannot serve.
    index("feature_flag_organizations_flag_idx").on(t.flagKey),
  ],
);
