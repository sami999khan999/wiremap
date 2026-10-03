CREATE TABLE "invitation_links" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"created_by" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"max_uses" integer,
	"uses" integer DEFAULT 0 NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organization_domains" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"domain" text NOT NULL,
	"role_id" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "team_members" (
	"organization_id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "team_members_organization_id_team_id_user_id_pk" PRIMARY KEY("organization_id","team_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "teams" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "invitation_links" ADD CONSTRAINT "invitation_links_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation_links" ADD CONSTRAINT "invitation_links_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation_links" ADD CONSTRAINT "invitation_links_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_domains" ADD CONSTRAINT "organization_domains_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_domains" ADD CONSTRAINT "organization_domains_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_domains" ADD CONSTRAINT "organization_domains_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "invitation_links_token_uq" ON "invitation_links" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "invitation_links_org_idx" ON "invitation_links" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "invitation_links_role_idx" ON "invitation_links" USING btree ("role_id");--> statement-breakpoint
CREATE INDEX "invitation_links_creator_idx" ON "invitation_links" USING btree ("created_by");--> statement-breakpoint
CREATE UNIQUE INDEX "organization_domains_domain_uq" ON "organization_domains" USING btree ("domain");--> statement-breakpoint
CREATE INDEX "organization_domains_org_idx" ON "organization_domains" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "organization_domains_role_idx" ON "organization_domains" USING btree ("role_id");--> statement-breakpoint
CREATE INDEX "organization_domains_creator_idx" ON "organization_domains" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "team_members_user_idx" ON "team_members" USING btree ("organization_id","user_id");--> statement-breakpoint
CREATE INDEX "team_members_team_fk_idx" ON "team_members" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "team_members_user_fk_idx" ON "team_members" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "teams_name_uq" ON "teams" USING btree ("organization_id",lower("name"));--> statement-breakpoint
-- The data half, by hand: drizzle diffs schema, not rows. Every existing organization gets
-- the `viewer` system role, and the system roles get wiremap's new keys. `SystemRoleSeed`
-- writes the same for an organization founded from now on.
INSERT INTO "roles" ("id", "organization_id", "key", "name", "scope", "is_system")
SELECT gen_random_uuid(), "o"."id", 'viewer', 'Viewer', 'org', true
FROM "organizations" "o"
WHERE EXISTS (SELECT 1 FROM "roles" "r" WHERE "r"."organization_id" = "o"."id" AND "r"."key" = 'owner')
ON CONFLICT ("organization_id", "key") DO NOTHING;--> statement-breakpoint
INSERT INTO "role_permissions" ("organization_id", "role_id", "permission")
SELECT "r"."organization_id", "r"."id", "k"."permission"
FROM "roles" "r"
JOIN (VALUES
  ('owner', 'member.remove'),
  ('owner', 'member.team.manage'),
  ('owner', 'member.domain.manage'),
  ('owner', 'organization.profile.update'),
  ('owner', 'organization.ownership.transfer'),
  ('owner', 'organization.delete'),
  ('owner', 'audit.log.read'),
  ('platform_admin', 'member.remove'),
  ('platform_admin', 'member.team.manage'),
  ('platform_admin', 'member.domain.manage'),
  ('platform_admin', 'organization.profile.update'),
  ('platform_admin', 'organization.ownership.transfer'),
  ('platform_admin', 'organization.delete'),
  ('platform_admin', 'audit.log.read'),
  ('admin', 'member.team.manage'),
  ('admin', 'member.domain.manage'),
  ('admin', 'organization.profile.update'),
  ('admin', 'audit.log.read'),
  ('viewer', 'member.read'),
  ('viewer', 'notification.inbox.read'),
  ('viewer', 'notification.inbox.update'),
  ('viewer', 'notification.preference.update'),
  ('viewer', 'doc.page.read')
) AS "k" ("role_key", "permission") ON "k"."role_key" = "r"."key"
WHERE "r"."is_system" = true
ON CONFLICT DO NOTHING;
