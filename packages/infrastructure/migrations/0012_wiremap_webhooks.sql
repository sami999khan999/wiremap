CREATE TABLE "webhooks" (
	"id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid,
	"kind" text NOT NULL,
	"encrypted_url" text NOT NULL,
	"url_hint" text NOT NULL,
	"encrypted_secret" text,
	"events" text[] NOT NULL,
	"disabled_at" timestamp with time zone,
	"failure_count" integer DEFAULT 0 NOT NULL,
	"last_status" integer,
	"last_delivered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "webhooks_id_organization_id_pk" PRIMARY KEY("id","organization_id")
) PARTITION BY LIST ("organization_id");
--> statement-breakpoint
CREATE INDEX "webhooks_project_idx" ON "webhooks" USING btree ("organization_id","project_id");--> statement-breakpoint
-- The data half, by hand: managing webhooks for the roles that run the organization. The
-- seed covers new organizations.
INSERT INTO "role_permissions" ("organization_id", "role_id", "permission")
SELECT "r"."organization_id", "r"."id", "k"."permission"
FROM "roles" "r"
JOIN (VALUES
  ('owner', 'organization.webhook.manage'),
  ('admin', 'organization.webhook.manage'),
  ('platform_admin', 'organization.webhook.manage')
) AS "k" ("role_key", "permission") ON "k"."role_key" = "r"."key"
ON CONFLICT DO NOTHING;
