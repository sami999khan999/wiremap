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
import { users } from "./auth.schema.js";
import { organizations } from "./rbac.schema.js";

// A named group of members. Catalog, beside `goal_members`, because the capability read
// joins team grants to it.
export const teams = pgTable(
  "teams",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .$type<OrganizationId>()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Case-insensitive, matching `existsByName`: "Backend" and "backend" are one team.
    uniqueIndex("teams_name_uq").on(t.organizationId, sql`lower(${t.name})`),
  ],
);

export const teamMembers = pgTable(
  "team_members",
  {
    organizationId: uuid("organization_id")
      .$type<OrganizationId>()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    teamId: uuid("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .$type<UserId>()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.organizationId, t.teamId, t.userId] }),
    // "Which teams is this person in", read with every capability resolution.
    index("team_members_user_idx").on(t.organizationId, t.userId),
    index("team_members_team_fk_idx").on(t.teamId),
    index("team_members_user_fk_idx").on(t.userId),
  ],
);
