-- Retention stops meaning deletion. `activity_archive` recorded where one table's months
-- went; this records where every partitioned table's tenant-months go, and it is the index
-- a read of cold storage starts from.
--
-- `organization_id` leads the primary key, so this table needs no §9 exemption and a
-- tenant's cold months can be read, swept and totalled without touching another's. It is
-- deliberately **not** a foreign key to `organizations`, for the reason the audit trail
-- gives about its actor: the archive is what survives the tenant, and a cascade would
-- erase it. Deleting a tenant reaches cold storage through the sweep instead.
CREATE TABLE "partition_archive" (
	"organization_id" uuid NOT NULL,
	"table_name" text NOT NULL,
	"period" date NOT NULL,
	"object_key" text NOT NULL,
	"row_count" integer NOT NULL,
	"bytes" bigint NOT NULL,
	"checksum" text NOT NULL,
	"action_counts" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"projected_at" timestamp with time zone,
	"archived_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "partition_archive_organization_id_table_name_period_pk" PRIMARY KEY("organization_id","table_name","period")
);
--> statement-breakpoint
-- Partial, so "which tenant-month has a hole in ClickHouse" is an index read rather than
-- a scan over every month this system has ever archived.
CREATE INDEX "partition_archive_unprojected_idx" ON "partition_archive" USING btree ("table_name","period") WHERE projected_at is null;--> statement-breakpoint

-- Every row `activity_archive` holds, carried across with the key it already names: the
-- object is where it is, and rewriting the key would point this index at nothing. The
-- nil-uuid rows written by `0024` come across as they are — a pre-tenant object holds
-- every tenant's month, and there is no correct id to invent for it.
--
-- `bytes` is 0 and `action_counts` empty because nothing recorded either before this
-- migration, and `projected_at` stays null because nothing recorded that either: null
-- means "ClickHouse may not have this", which for these rows is the honest answer.
-- `activity_archive` itself stays until no deployment can still hold objects under the
-- old `activity-archive/` prefix; a later migration drops it and its §9 exemption.
INSERT INTO "partition_archive" ("organization_id", "table_name", "period", "object_key", "row_count", "bytes", "checksum", "archived_at")
SELECT "organization_id", 'activity_log', "period", "object_key", "row_count", 0, "checksum", "archived_at"
FROM "activity_archive"
ON CONFLICT DO NOTHING;
