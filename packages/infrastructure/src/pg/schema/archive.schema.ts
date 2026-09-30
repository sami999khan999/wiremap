import {
  bigint,
  date,
  index,
  integer,
  jsonb,
  type OrganizationId,
  pgTable,
  primaryKey,
  sql,
  text,
  timestamp,
  uuid,
} from "../../import.js";

// The index a read of cold storage starts from: one row per tenant-month per table, and
// the only place this system records what an archived object holds or costs.
export const partitionArchive = pgTable(
  "partition_archive",
  {
    // No foreign key to `organizations`, for the reason the audit trail gives about its
    // actor: the archive is what survives the tenant, and a cascade would erase it.
    organizationId: uuid("organization_id").$type<OrganizationId>().notNull(),
    // Never from data: `PartitionedTableName` is the closed union every writer inlines,
    // which is the same injection boundary the DDL in the gateways relies on.
    tableName: text("table_name").notNull(),
    period: date("period", { mode: "string" }).notNull(),
    objectKey: text("object_key").notNull(),
    rowCount: integer("row_count").notNull(),
    // What the object costs. `StorageGateway` computes it on every put and nothing else
    // in this repository kept it, so a per-tenant storage total had nowhere to come from.
    bytes: bigint("bytes", { mode: "number" }).notNull(),
    checksum: text("checksum").notNull(),
    // `{ "<action>": n }`, counted for free while the rows stream out. Empty for a table
    // with no `action` column. Read by the cold half of the reconciliation.
    actionCounts: jsonb("action_counts")
      .$type<Record<string, number>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    // Null means ClickHouse never received this tenant-month. A gap is recorded here
    // rather than blocking the drop — see docs/reference/cold-storage.md.
    projectedAt: timestamp("projected_at", { withTimezone: true }),
    archivedAt: timestamp("archived_at", { withTimezone: true }).notNull().defaultNow(),
    // When the tenant was deleted, not when the month was archived. The recovery
    // window runs from here — see docs/reference/cold-storage.md.
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    // Leading with the tenant is not cosmetic: it is what lets one tenant's cold months
    // be read, swept and totalled without touching another's.
    primaryKey({ columns: [t.organizationId, t.tableName, t.period] }),
    // Partial, so "what has a hole" is an index read rather than a scan over every
    // tenant-month this system has ever archived.
    index("partition_archive_unprojected_idx")
      .on(t.tableName, t.period)
      .where(sql`projected_at is null`),
    // Partial for the same reason: the nightly sweep asks "what was deleted before X",
    // and every row of a live tenant is null here.
    index("partition_archive_deleted_idx").on(t.deletedAt).where(sql`deleted_at is not null`),
  ],
);
