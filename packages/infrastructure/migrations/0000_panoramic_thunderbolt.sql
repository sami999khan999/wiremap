CREATE TABLE "activity_log" (
	"id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"actor_id" text NOT NULL,
	"action" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "activity_log_id_occurred_at_pk" PRIMARY KEY("id","occurred_at")
) PARTITION BY RANGE ("occurred_at");--> statement-breakpoint
-- Hand-written: drizzle-kit cannot express PARTITION BY, and converting a large
-- table later is a rewrite with downtime. Partitioned in the first migration.
-- No DEFAULT partition on purpose: a catch-all silently absorbs a month whose
-- partition is missing, and attaching the real one afterwards means moving rows.
CREATE TABLE "activity_log_2026_08" PARTITION OF "activity_log" FOR VALUES FROM ('2026-08-01') TO ('2026-09-01');--> statement-breakpoint
CREATE TABLE "activity_log_2026_09" PARTITION OF "activity_log" FOR VALUES FROM ('2026-09-01') TO ('2026-10-01');--> statement-breakpoint
CREATE TABLE "activity_log_2026_10" PARTITION OF "activity_log" FOR VALUES FROM ('2026-10-01') TO ('2026-11-01');--> statement-breakpoint
CREATE TABLE "activity_log_2026_11" PARTITION OF "activity_log" FOR VALUES FROM ('2026-11-01') TO ('2026-12-01');--> statement-breakpoint
CREATE TABLE "activity_log_2026_12" PARTITION OF "activity_log" FOR VALUES FROM ('2026-12-01') TO ('2027-01-01');--> statement-breakpoint
CREATE TABLE "activity_log_2027_01" PARTITION OF "activity_log" FOR VALUES FROM ('2027-01-01') TO ('2027-02-01');
--> statement-breakpoint
CREATE TABLE "activity_archive" (
	"period" date PRIMARY KEY NOT NULL,
	"object_key" text NOT NULL,
	"row_count" integer NOT NULL,
	"checksum" text NOT NULL,
	"archived_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "goal_risk_daily" (
	"organization_id" uuid NOT NULL,
	"goal_id" uuid NOT NULL,
	"period" date NOT NULL,
	"score" real NOT NULL,
	"tasks_total" integer NOT NULL,
	"tasks_overdue" integer NOT NULL,
	"tasks_blocked" integer NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "goal_risk_daily_organization_id_goal_id_period_pk" PRIMARY KEY("organization_id","goal_id","period")
);
--> statement-breakpoint
CREATE TABLE "user_reliability_daily" (
	"organization_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"goal_id" uuid NOT NULL,
	"period" date NOT NULL,
	"commitments_met" integer NOT NULL,
	"commitments_total" integer NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_reliability_daily_organization_id_user_id_goal_id_period_pk" PRIMARY KEY("organization_id","user_id","goal_id","period")
);
--> statement-breakpoint
CREATE TABLE "goal_members" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"goal_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"role_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"role_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "permission_overrides" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"goal_id" uuid,
	"permission" text NOT NULL,
	"effect" text NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "role_permissions" (
	"organization_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	"permission" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"scope" text NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "goal_members" ADD CONSTRAINT "goal_members_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goal_members" ADD CONSTRAINT "goal_members_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "permission_overrides" ADD CONSTRAINT "permission_overrides_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roles" ADD CONSTRAINT "roles_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activity_log_org_time_idx" ON "activity_log" USING btree ("organization_id","occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "goal_risk_daily_goal_idx" ON "goal_risk_daily" USING btree ("goal_id","period" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "user_reliability_daily_user_idx" ON "user_reliability_daily" USING btree ("user_id","period");--> statement-breakpoint
CREATE UNIQUE INDEX "goal_members_uq" ON "goal_members" USING btree ("goal_id","user_id","role_id");--> statement-breakpoint
CREATE INDEX "goal_members_user_idx" ON "goal_members" USING btree ("organization_id","user_id");--> statement-breakpoint
CREATE INDEX "goal_members_goal_idx" ON "goal_members" USING btree ("goal_id");--> statement-breakpoint
CREATE INDEX "goal_members_role_idx" ON "goal_members" USING btree ("role_id");--> statement-breakpoint
CREATE UNIQUE INDEX "memberships_uq" ON "memberships" USING btree ("user_id","role_id");--> statement-breakpoint
CREATE INDEX "memberships_user_idx" ON "memberships" USING btree ("organization_id","user_id");--> statement-breakpoint
CREATE INDEX "memberships_role_idx" ON "memberships" USING btree ("role_id");--> statement-breakpoint
CREATE INDEX "permission_overrides_user_idx" ON "permission_overrides" USING btree ("organization_id","user_id");--> statement-breakpoint
CREATE INDEX "permission_overrides_goal_idx" ON "permission_overrides" USING btree ("goal_id");--> statement-breakpoint
CREATE UNIQUE INDEX "permission_overrides_uq" ON "permission_overrides" USING btree ("user_id","goal_id","permission");--> statement-breakpoint
CREATE UNIQUE INDEX "role_permissions_uq" ON "role_permissions" USING btree ("role_id","permission");--> statement-breakpoint
CREATE INDEX "role_permissions_organization_idx" ON "role_permissions" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "roles_key_uq" ON "roles" USING btree ("organization_id","key");--> statement-breakpoint
CREATE INDEX "roles_organization_idx" ON "roles" USING btree ("organization_id");