CREATE TABLE "notification_preferences" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"category" text NOT NULL,
	"channel" text NOT NULL,
	"mode" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"category" text NOT NULL,
	"params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"link" text,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notifications_id_created_at_pk" PRIMARY KEY("id","created_at")
) PARTITION BY RANGE ("created_at");--> statement-breakpoint
-- Hand-written: drizzle-kit cannot express PARTITION BY. `notifications` grows with
-- activity rather than with the calendar, so it is partitioned in its first migration —
-- converting it later is a rewrite with downtime.
-- No DEFAULT partition, for the reason activity_log gives: a catch-all silently absorbs
-- a month whose partition is missing, and attaching the real one means moving rows.
-- Six months of runway; `partitions-monthly` keeps three ahead, because `notifications`
-- joins PartitionedTable.ALL in this change.
CREATE TABLE "notifications_2026_09" PARTITION OF "notifications" FOR VALUES FROM ('2026-09-01') TO ('2026-10-01');--> statement-breakpoint
CREATE TABLE "notifications_2026_10" PARTITION OF "notifications" FOR VALUES FROM ('2026-10-01') TO ('2026-11-01');--> statement-breakpoint
CREATE TABLE "notifications_2026_11" PARTITION OF "notifications" FOR VALUES FROM ('2026-11-01') TO ('2026-12-01');--> statement-breakpoint
CREATE TABLE "notifications_2026_12" PARTITION OF "notifications" FOR VALUES FROM ('2026-12-01') TO ('2027-01-01');--> statement-breakpoint
CREATE TABLE "notifications_2027_01" PARTITION OF "notifications" FOR VALUES FROM ('2027-01-01') TO ('2027-02-01');--> statement-breakpoint
CREATE TABLE "notifications_2027_02" PARTITION OF "notifications" FOR VALUES FROM ('2027-02-01') TO ('2027-03-01');--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "notification_preferences_uq" ON "notification_preferences" USING btree ("organization_id","user_id","category","channel");--> statement-breakpoint
CREATE INDEX "notification_preferences_user_fk_idx" ON "notification_preferences" USING btree ("user_id");--> statement-breakpoint
-- The keyset, in the exact order the list ORDER BYs. `DESC NULLS LAST` on both, so the
-- index and the query agree and Postgres can walk it rather than sort.
CREATE INDEX "notifications_inbox_idx" ON "notifications" USING btree ("organization_id","user_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "notifications_unread_idx" ON "notifications" USING btree ("organization_id","user_id") WHERE read_at is null;--> statement-breakpoint
-- The idempotency key, and the reason a replayed event writes no second row. Tenant-
-- leading, per §17.
--
-- `created_at` is in it because Postgres refuses a unique index on a partitioned table
-- that does not carry every partitioning column. That is only sound because the column
-- is the **event's** `occurred_at` and not `now()`: a redelivery of the same event
-- computes the same value, so the row collides instead of landing beside itself.
CREATE UNIQUE INDEX "notifications_dedupe_uq" ON "notifications" USING btree ("organization_id","user_id","event_id","kind","created_at");--> statement-breakpoint
CREATE INDEX "notifications_user_fk_idx" ON "notifications" USING btree ("user_id");