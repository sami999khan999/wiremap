import {
  index,
  integer,
  jsonb,
  type OrganizationId,
  type ProjectId,
  pgTable,
  primaryKey,
  type ScanCounts,
  type ScanId,
  sql,
  text,
  timestamp,
  type UserId,
  uuid,
} from "../../import.js";

// Tenant then month: a scan per push grows with the calendar. Routed, so no key to the
// catalog's `projects`; deleting a project sweeps these by its id.
export const scans = pgTable(
  "scans",
  {
    id: uuid("id").$type<ScanId>().notNull(),
    organizationId: uuid("organization_id").$type<OrganizationId>().notNull(),
    projectId: uuid("project_id").$type<ProjectId>().notNull(),
    trigger: text("trigger", { enum: ["push", "schedule", "manual", "upload"] }).notNull(),
    state: text("state", {
      enum: ["queued", "running", "succeeded", "failed", "cancelled"],
    }).notNull(),
    branch: text("branch"),
    commitSha: text("commit_sha"),
    requestedBy: uuid("requested_by").$type<UserId>(),
    // When it was queued, and the month key.
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    error: text("error"),
    graphKey: text("graph_key"),
    graphBytes: integer("graph_bytes"),
    counts: jsonb("counts").$type<ScanCounts>(),
    analyzerVersion: text("analyzer_version"),
  },
  (t) => [
    primaryKey({ columns: [t.id, t.organizationId, t.createdAt] }),
    index("scans_project_idx").on(t.organizationId, t.projectId, t.createdAt.desc()),
    // "Is one already queued or running": the dedupe every trigger asks.
    index("scans_active_idx")
      .on(t.organizationId, t.projectId)
      .where(sql`state in ('queued', 'running')`),
    // The hourly sweep, across tenants on one node: small, because it holds only live scans.
    index("scans_stale_idx").on(t.createdAt).where(sql`state in ('queued', 'running')`),
  ],
);

// A project's open findings, keyed by what they are, so the next scan's diff is a lookup.
export const scanFindings = pgTable(
  "scan_findings",
  {
    organizationId: uuid("organization_id").$type<OrganizationId>().notNull(),
    projectId: uuid("project_id").$type<ProjectId>().notNull(),
    kind: text("kind", { enum: ["cycle", "unguarded_route"] }).notNull(),
    key: text("key").notNull(),
    // The scan that first found it; it stays open until a scan no longer does.
    scanId: uuid("scan_id").$type<ScanId>().notNull(),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.organizationId, t.projectId, t.kind, t.key] })],
);
