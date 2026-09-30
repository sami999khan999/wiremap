-- One row per activity action, deciding whether it reaches the analytics store and for
-- how long. An absent row is "projected, with the default TTL", so an empty table
-- behaves exactly as the deploy before it existed.
--
-- No `organization_id`, and it is the third table to claim that exemption: the
-- projection is one deployment-wide decision, and a per-tenant row would describe
-- something the consumer does not do.
CREATE TABLE "projection_policy" (
	"action" text PRIMARY KEY NOT NULL,
	"projected" boolean DEFAULT true NOT NULL,
	"ttl_months" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "projection_policy_ttl_months_ck" CHECK ("projection_policy"."ttl_months" is null or "projection_policy"."ttl_months" >= 1)
);
