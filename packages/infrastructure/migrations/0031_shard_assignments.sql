-- The directory: which physical node holds a key's rows. A catalog table, read
-- before any shard is known, which is what makes it the one place that can say.
--
-- No `organization_id` and no foreign key to `organizations`. The key is the
-- strategy's to choose — the shipped one uses the organization id, and a fork
-- sharding on region would put a region here.
CREATE TABLE "shard_assignments" (
	"shard_key" text PRIMARY KEY NOT NULL,
	"node" smallint DEFAULT 0 NOT NULL,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"moved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "shard_assignments_node_idx" ON "shard_assignments" USING btree ("node");

--> statement-breakpoint
-- Backfilled rather than left empty, so `resolve()` reads a row for every tenant that
-- already exists rather than falling through to the default. Node 0 is the only node
-- an unsharded deployment has, so the backfill is a constant.
INSERT INTO "shard_assignments" ("shard_key", "node")
SELECT id::text, 0 FROM "organizations"
ON CONFLICT DO NOTHING;
