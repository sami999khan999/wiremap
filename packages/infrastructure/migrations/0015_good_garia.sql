CREATE TABLE "outbox_event" (
	"id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"actor_id" uuid NOT NULL,
	"name" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone,
	CONSTRAINT "outbox_event_id_occurred_at_pk" PRIMARY KEY("id","occurred_at")
) PARTITION BY RANGE ("occurred_at");--> statement-breakpoint
-- Hand-written: drizzle-kit cannot express PARTITION BY, and converting a table that
-- grows with every write later is a rewrite with downtime. Partitioned from the start.
-- No DEFAULT partition, for the reason activity_log gives: a catch-all silently absorbs
-- a month whose partition is missing, and attaching the real one means moving rows.
-- Six months of runway; `partitions-monthly` keeps three ahead from here on, because
-- `outbox_event` joins PartitionedTable.ALL in this change.
CREATE TABLE "outbox_event_2026_09" PARTITION OF "outbox_event" FOR VALUES FROM ('2026-09-01') TO ('2026-10-01');--> statement-breakpoint
CREATE TABLE "outbox_event_2026_10" PARTITION OF "outbox_event" FOR VALUES FROM ('2026-10-01') TO ('2026-11-01');--> statement-breakpoint
CREATE TABLE "outbox_event_2026_11" PARTITION OF "outbox_event" FOR VALUES FROM ('2026-11-01') TO ('2026-12-01');--> statement-breakpoint
CREATE TABLE "outbox_event_2026_12" PARTITION OF "outbox_event" FOR VALUES FROM ('2026-12-01') TO ('2027-01-01');--> statement-breakpoint
CREATE TABLE "outbox_event_2027_01" PARTITION OF "outbox_event" FOR VALUES FROM ('2027-01-01') TO ('2027-02-01');--> statement-breakpoint
CREATE TABLE "outbox_event_2027_02" PARTITION OF "outbox_event" FOR VALUES FROM ('2027-02-01') TO ('2027-03-01');--> statement-breakpoint
ALTER TABLE "outbox_event" ADD CONSTRAINT "outbox_event_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- The drain's keyset, and cross-tenant on purpose: the worker drains every organization
-- in one pass, so an index leading with the tenant would make it scan every partition.
CREATE INDEX "outbox_event_pending_idx" ON "outbox_event" USING btree ("occurred_at","id") WHERE published_at is null;--> statement-breakpoint
CREATE INDEX "outbox_event_published_idx" ON "outbox_event" USING btree ("published_at") WHERE published_at is not null;--> statement-breakpoint
CREATE INDEX "outbox_event_org_idx" ON "outbox_event" USING btree ("organization_id","occurred_at");
