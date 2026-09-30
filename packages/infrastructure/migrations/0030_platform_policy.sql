-- One row, forever. `check (id = 1)` is what makes that a database guarantee rather
-- than a convention: a second row would be a second deployment-wide answer, and the
-- repository reads `get()` without an order by.
--
-- The row is **not** inserted here. An absent row is the defaults, so a deployment that
-- never touches this screen behaves exactly as the deploy before the table existed, and
-- the first save is what creates it.
--
-- No `organization_id`, and it is the fourth table to claim that exemption: a
-- deployment-wide switch has no tenant to belong to.
CREATE TABLE "platform_policy" (
	"id" smallint PRIMARY KEY NOT NULL,
	"projection_enabled" boolean DEFAULT true NOT NULL,
	"replica_reads_enabled" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platform_policy_singleton_ck" CHECK ("platform_policy"."id" = 1)
);
