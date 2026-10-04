CREATE TABLE "github_apps" (
	"id" smallint PRIMARY KEY NOT NULL,
	"app_id" text NOT NULL,
	"slug" text NOT NULL,
	"html_url" text NOT NULL,
	"owner_login" text NOT NULL,
	"client_id" text NOT NULL,
	"encrypted_private_key" text NOT NULL,
	"encrypted_webhook_secret" text NOT NULL,
	"encrypted_client_secret" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "github_apps_singleton_ck" CHECK ("github_apps"."id" = 1)
);
--> statement-breakpoint
-- The data half, by hand: the platform admin creates the App. The platform role seed grants
-- it too, on every start; this covers a deployment that never seeds again.
INSERT INTO "role_permissions" ("organization_id", "role_id", "permission")
SELECT "r"."organization_id", "r"."id", 'platform.github.manage'
FROM "roles" "r"
WHERE "r"."key" = 'platform_admin'
ON CONFLICT DO NOTHING;
