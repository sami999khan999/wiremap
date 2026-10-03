import {
  type GraphViewId,
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

// Saved explorer views. Routed with the tenant's scans, so no key to the catalog's
// `projects`; the project purge sweeps them by id.
export const graphViews = pgTable(
  "graph_views",
  {
    id: uuid("id").$type<GraphViewId>().notNull(),
    organizationId: uuid("organization_id").$type<OrganizationId>().notNull(),
    projectId: uuid("project_id").$type<ProjectId>().notNull(),
    name: text("name").notNull(),
    // The explorer's query string, which is its whole state.
    state: text("state").notNull(),
    createdBy: uuid("created_by").$type<UserId>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.id, t.organizationId] }),
    index("graph_views_project_idx").on(t.organizationId, t.projectId),
  ],
);
