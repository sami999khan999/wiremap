-- `PF.3`: warm spares, so a signup pays no partition DDL.
--
-- A spare is a tenant id whose sixteen partitions already exist on node 0 and whose
-- `organizations` row does not. The worker keeps a small pool topped up, one spare per
-- transaction with its partitions, so a crash never leaves partitions nothing names.
-- The founder claims the oldest with `FOR UPDATE SKIP LOCKED` inside its own
-- transaction; an empty pool seeds inline exactly as before.
--
-- Catalog, and new and empty: nothing reads it until the worker fills it.
CREATE TABLE "spare_tenants" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "spare_tenants_created_idx" ON "spare_tenants" USING btree ("created_at");