CREATE TABLE "organization_ai" (
	"organization_id" uuid NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"provider" text DEFAULT 'none' NOT NULL,
	"model" text NOT NULL,
	"encrypted_key" text,
	"key_hint" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "scans" ADD COLUMN "summary" text;--> statement-breakpoint
CREATE UNIQUE INDEX "organization_ai_organization_uq" ON "organization_ai" USING btree ("organization_id");--> statement-breakpoint
ALTER TABLE "organization_ai" ADD CONSTRAINT "organization_ai_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- The data half, by hand: the AI settings key for the roles that run the organization, and
-- asking about a project for every role that reads one. The seed covers new organizations.
INSERT INTO "role_permissions" ("organization_id", "role_id", "permission")
SELECT "r"."organization_id", "r"."id", "k"."permission"
FROM "roles" "r"
JOIN (VALUES
  ('owner', 'organization.ai.manage'),
  ('admin', 'organization.ai.manage'),
  ('platform_admin', 'organization.ai.manage'),
  ('owner', 'project.ask.use'),
  ('admin', 'project.ask.use'),
  ('platform_admin', 'project.ask.use'),
  ('project_admin', 'project.ask.use'),
  ('project_editor', 'project.ask.use'),
  ('project_viewer', 'project.ask.use')
) AS "k" ("role_key", "permission") ON "k"."role_key" = "r"."key"
ON CONFLICT DO NOTHING;
