CREATE TABLE "github_installations" (
	"organization_id" uuid NOT NULL,
	"installation_id" bigint NOT NULL,
	"account_login" text NOT NULL,
	"suspended_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "github_installations_organization_id_installation_id_pk" PRIMARY KEY("organization_id","installation_id")
);
--> statement-breakpoint
CREATE TABLE "project_grants" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"user_id" uuid,
	"team_id" uuid,
	"role" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_grants_one_grantee" CHECK (("project_grants"."user_id" is null) <> ("project_grants"."team_id" is null))
);
--> statement-breakpoint
CREATE TABLE "project_repositories" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"external_id" text,
	"full_name" text NOT NULL,
	"default_branch" text NOT NULL,
	"branches" text[] DEFAULT '{}'::text[] NOT NULL,
	"root_path" text,
	"private" boolean DEFAULT true NOT NULL,
	"installation_id" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"visibility" text DEFAULT 'org' NOT NULL,
	"default_role" text DEFAULT 'project_viewer' NOT NULL,
	"schedule" text DEFAULT 'off' NOT NULL,
	"ignore" text[] DEFAULT '{}'::text[] NOT NULL,
	"settings" jsonb DEFAULT '{"tsconfigPath":null,"workspace":null}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "github_installations" ADD CONSTRAINT "github_installations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_grants" ADD CONSTRAINT "project_grants_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_grants" ADD CONSTRAINT "project_grants_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_grants" ADD CONSTRAINT "project_grants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_grants" ADD CONSTRAINT "project_grants_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_repositories" ADD CONSTRAINT "project_repositories_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_repositories" ADD CONSTRAINT "project_repositories_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "github_installations_installation_idx" ON "github_installations" USING btree ("installation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "project_grants_user_uq" ON "project_grants" USING btree ("organization_id","project_id","user_id") WHERE "project_grants"."user_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "project_grants_team_uq" ON "project_grants" USING btree ("organization_id","project_id","team_id") WHERE "project_grants"."team_id" is not null;--> statement-breakpoint
CREATE INDEX "project_grants_project_idx" ON "project_grants" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "project_grants_user_idx" ON "project_grants" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "project_grants_team_idx" ON "project_grants" USING btree ("team_id");--> statement-breakpoint
CREATE UNIQUE INDEX "project_repositories_uq" ON "project_repositories" USING btree ("organization_id","project_id","provider","external_id") WHERE "project_repositories"."external_id" is not null;--> statement-breakpoint
CREATE INDEX "project_repositories_external_idx" ON "project_repositories" USING btree ("provider","external_id");--> statement-breakpoint
CREATE INDEX "project_repositories_project_idx" ON "project_repositories" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "project_repositories_org_idx" ON "project_repositories" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "projects_slug_uq" ON "projects" USING btree ("organization_id","slug") WHERE "projects"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "projects_schedule_idx" ON "projects" USING btree ("schedule") WHERE "projects"."deleted_at" is null and "projects"."schedule" <> 'off';--> statement-breakpoint
-- The data half, by hand. Three `goal`-scoped system roles per organization, which a
-- project's grants and default role name, and the project keys for the org-level roles.
INSERT INTO "roles" ("id", "organization_id", "key", "name", "scope", "is_system")
SELECT gen_random_uuid(), "o"."id", "k"."key", "k"."name", 'goal', true
FROM "organizations" "o"
CROSS JOIN (VALUES
  ('project_admin', 'Project admin'),
  ('project_editor', 'Project editor'),
  ('project_viewer', 'Project viewer')
) AS "k" ("key", "name")
WHERE EXISTS (SELECT 1 FROM "roles" "r" WHERE "r"."organization_id" = "o"."id" AND "r"."key" = 'owner')
ON CONFLICT ("organization_id", "key") DO NOTHING;--> statement-breakpoint
INSERT INTO "role_permissions" ("organization_id", "role_id", "permission")
SELECT "r"."organization_id", "r"."id", "k"."permission"
FROM "roles" "r"
JOIN (VALUES
  ('owner', 'project.create'),
  ('owner', 'project.graph.read'),
  ('owner', 'project.settings.manage'),
  ('owner', 'project.access.manage'),
  ('owner', 'project.delete'),
  ('platform_admin', 'project.create'),
  ('platform_admin', 'project.graph.read'),
  ('platform_admin', 'project.settings.manage'),
  ('platform_admin', 'project.access.manage'),
  ('platform_admin', 'project.delete'),
  ('admin', 'project.create'),
  ('admin', 'project.graph.read'),
  ('admin', 'project.settings.manage'),
  ('admin', 'project.access.manage'),
  ('admin', 'project.delete'),
  ('member', 'project.create'),
  ('project_admin', 'project.graph.read'),
  ('project_admin', 'project.settings.manage'),
  ('project_admin', 'project.access.manage'),
  ('project_admin', 'project.delete'),
  ('project_editor', 'project.graph.read'),
  ('project_viewer', 'project.graph.read')
) AS "k" ("role_key", "permission") ON "k"."role_key" = "r"."key"
WHERE "r"."is_system" = true
ON CONFLICT DO NOTHING;
