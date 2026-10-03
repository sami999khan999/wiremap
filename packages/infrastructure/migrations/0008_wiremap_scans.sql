CREATE TABLE "scan_findings" (
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"key" text NOT NULL,
	"scan_id" uuid NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "scan_findings_organization_id_project_id_kind_key_pk" PRIMARY KEY("organization_id","project_id","kind","key")
) PARTITION BY LIST ("organization_id");
--> statement-breakpoint
CREATE TABLE "scans" (
	"id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"trigger" text NOT NULL,
	"state" text NOT NULL,
	"branch" text,
	"commit_sha" text,
	"requested_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"error" text,
	"graph_key" text,
	"graph_bytes" integer,
	"counts" jsonb,
	"analyzer_version" text,
	CONSTRAINT "scans_id_organization_id_created_at_pk" PRIMARY KEY("id","organization_id","created_at")
) PARTITION BY LIST ("organization_id");
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "last_scheduled_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "scans_project_idx" ON "scans" USING btree ("organization_id","project_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "scans_active_idx" ON "scans" USING btree ("organization_id","project_id") WHERE state in ('queued', 'running');--> statement-breakpoint
CREATE INDEX "scans_stale_idx" ON "scans" USING btree ("created_at") WHERE state in ('queued', 'running');--> statement-breakpoint
-- The data half, by hand: `project.scan.run` for the roles that already administer or edit
-- projects. The seed grants it to organizations founded from now on.
INSERT INTO "role_permissions" ("organization_id", "role_id", "permission")
SELECT "r"."organization_id", "r"."id", 'project.scan.run'
FROM "roles" "r"
WHERE "r"."key" IN ('owner', 'admin', 'platform_admin', 'project_admin', 'project_editor')
ON CONFLICT DO NOTHING;
