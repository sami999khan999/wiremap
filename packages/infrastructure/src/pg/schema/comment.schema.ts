import {
  boolean,
  type CommentId,
  index,
  type OrganizationId,
  type ProjectId,
  pgTable,
  primaryKey,
  text,
  timestamp,
  type UserId,
  uuid,
} from "../../import.js";

// A project's comments, tenant-partitioned. Routed, so no key to `projects`; the project
// purge sweeps them. A removed comment keeps its row, so its replies keep their thread.
export const comments = pgTable(
  "comments",
  {
    id: uuid("id").$type<CommentId>().notNull(),
    organizationId: uuid("organization_id").$type<OrganizationId>().notNull(),
    projectId: uuid("project_id").$type<ProjectId>().notNull(),
    targetKind: text("target_kind", { enum: ["file", "folder", "route", "project"] }).notNull(),
    targetKey: text("target_key").notNull(),
    body: text("body").notNull(),
    authorId: uuid("author_id").$type<UserId>().notNull(),
    parentId: uuid("parent_id").$type<CommentId>(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    pinned: boolean("pinned").notNull().default(false),
    editedAt: timestamp("edited_at", { withTimezone: true }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.id, t.organizationId] }),
    index("comments_target_idx").on(t.organizationId, t.projectId, t.targetKind, t.targetKey),
  ],
);
