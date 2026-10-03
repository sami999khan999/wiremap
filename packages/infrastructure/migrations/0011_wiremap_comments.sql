CREATE TABLE "comments" (
	"id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"target_kind" text NOT NULL,
	"target_key" text NOT NULL,
	"body" text NOT NULL,
	"author_id" uuid NOT NULL,
	"parent_id" uuid,
	"resolved_at" timestamp with time zone,
	"pinned" boolean DEFAULT false NOT NULL,
	"edited_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "comments_id_organization_id_pk" PRIMARY KEY("id","organization_id")
) PARTITION BY LIST ("organization_id");
--> statement-breakpoint
CREATE INDEX "comments_target_idx" ON "comments" USING btree ("organization_id","project_id","target_kind","target_key");--> statement-breakpoint
CREATE INDEX "activity_log_project_idx" ON "activity_log" USING btree ("organization_id",("payload"->>'projectId'),"occurred_at" DESC NULLS LAST);--> statement-breakpoint
-- The data half, by hand: commenting for the roles that run the organization and for every
-- project role that edits. A viewer reads the thread and writes none.
INSERT INTO "role_permissions" ("organization_id", "role_id", "permission")
SELECT "r"."organization_id", "r"."id", "k"."permission"
FROM "roles" "r"
JOIN (VALUES
  ('owner', 'project.comment.write'),
  ('admin', 'project.comment.write'),
  ('platform_admin', 'project.comment.write'),
  ('project_admin', 'project.comment.write'),
  ('project_editor', 'project.comment.write')
) AS "k" ("role_key", "permission") ON "k"."role_key" = "r"."key"
ON CONFLICT DO NOTHING;
