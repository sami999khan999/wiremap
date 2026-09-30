-- `0023` gave `activity_log` a tenant level, so a partition is per tenant per month and
-- the row recording where one went has to say which tenant. The archive keeps no foreign
-- key to `organizations`, for the reason the audit trail gives about its actor: this is
-- what survives the tenant, and a cascade would erase it.
--
-- A default, then dropped: the column is NOT NULL on a table that may already hold rows,
-- and a bare `ADD COLUMN ... NOT NULL` aborts halfway through a deploy — see docs/setup/13,
-- "Writing a unique-index migration", which is the same failure from the other side.
--
-- The nil uuid is the marker, not a tenant. A row written before this migration names an
-- object holding *every* tenant's rows for that month, and there is no correct id to
-- backfill: a replay reading one has to know it is reading a pre-tenant object.
ALTER TABLE "activity_archive" ADD COLUMN "organization_id" uuid DEFAULT '00000000-0000-0000-0000-000000000000' NOT NULL;--> statement-breakpoint
ALTER TABLE "activity_archive" ALTER COLUMN "organization_id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "activity_archive" DROP CONSTRAINT "activity_archive_pkey";--> statement-breakpoint
ALTER TABLE "activity_archive" ADD CONSTRAINT "activity_archive_organization_id_period_pk" PRIMARY KEY("organization_id","period");
