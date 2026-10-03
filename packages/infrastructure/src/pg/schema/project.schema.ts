import {
  bigint,
  boolean,
  check,
  index,
  jsonb,
  type OrganizationId,
  pgTable,
  sql,
  text,
  timestamp,
  type UserId,
  uniqueIndex,
  uuid,
} from "../../import.js";
import { users } from "./auth.schema.js";
import { organizations } from "./rbac.schema.js";
import { teams } from "./team.schema.js";

// A project: one or more repositories scanned together. Catalog, because whether a member
// may read it is resolved with their capabilities, and that read is catalog.
export const projects = pgTable(
  "projects",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .$type<OrganizationId>()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    visibility: text("visibility", { enum: ["org", "restricted"] })
      .notNull()
      .default("org"),
    defaultRole: text("default_role", {
      enum: ["project_admin", "project_editor", "project_viewer"],
    })
      .notNull()
      .default("project_viewer"),
    schedule: text("schedule", { enum: ["off", "daily", "weekly"] })
      .notNull()
      .default("off"),
    ignore: text("ignore").array().notNull().default(sql`'{}'::text[]`),
    settings: jsonb("settings")
      .$type<{ tsconfigPath: string | null; workspace: string | null }>()
      .notNull()
      .default({ tsconfigPath: null, workspace: null }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    // Set by a delete; the purge job removes the row once its data is gone.
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    // Live projects only, so a deleted project's slug is free again at once.
    uniqueIndex("projects_slug_uq").on(t.organizationId, t.slug).where(sql`${t.deletedAt} is null`),
    index("projects_schedule_idx")
      .on(t.schedule)
      .where(sql`${t.deletedAt} is null and ${t.schedule} <> 'off'`),
  ],
);

export const projectRepositories = pgTable(
  "project_repositories",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .$type<OrganizationId>()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    provider: text("provider", { enum: ["github", "upload"] }).notNull(),
    // The provider's own id, stable across renames. Null for an upload.
    externalId: text("external_id"),
    fullName: text("full_name").notNull(),
    defaultBranch: text("default_branch").notNull(),
    // Branches scanned on push; the default branch alone until someone adds more.
    branches: text("branches").array().notNull().default(sql`'{}'::text[]`),
    rootPath: text("root_path"),
    private: boolean("private").notNull().default(true),
    installationId: bigint("installation_id", { mode: "number" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("project_repositories_uq")
      .on(t.organizationId, t.projectId, t.provider, t.externalId)
      .where(sql`${t.externalId} is not null`),
    // A push arrives naming a repository and no tenant; this is how it finds the projects.
    index("project_repositories_external_idx").on(t.provider, t.externalId),
    index("project_repositories_project_idx").on(t.projectId),
    index("project_repositories_org_idx").on(t.organizationId),
  ],
);

export const projectGrants = pgTable(
  "project_grants",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .$type<OrganizationId>()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .$type<UserId>()
      .references(() => users.id, { onDelete: "cascade" }),
    teamId: uuid("team_id").references(() => teams.id, { onDelete: "cascade" }),
    role: text("role", { enum: ["project_admin", "project_editor", "project_viewer"] }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Two partial indexes, because a nullable column in one unique index enforces nothing
    // for the rows where it is null. See docs/ai/rules/vocabulary.md.
    uniqueIndex("project_grants_user_uq")
      .on(t.organizationId, t.projectId, t.userId)
      .where(sql`${t.userId} is not null`),
    uniqueIndex("project_grants_team_uq")
      .on(t.organizationId, t.projectId, t.teamId)
      .where(sql`${t.teamId} is not null`),
    check("project_grants_one_grantee", sql`(${t.userId} is null) <> (${t.teamId} is null)`),
    index("project_grants_project_idx").on(t.projectId),
    index("project_grants_user_idx").on(t.userId),
    index("project_grants_team_idx").on(t.teamId),
  ],
);
