CREATE TABLE "disabled_modules" (
	"module" text PRIMARY KEY NOT NULL,
	"reason" text NOT NULL,
	"disabled_by" uuid,
	"disabled_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "entitlement_adjustments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"permission" text NOT NULL,
	"effect" text NOT NULL,
	"reason" text NOT NULL,
	"expires_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plan_permissions" (
	"plan_key" text NOT NULL,
	"permission" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plans" (
	"key" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"is_unlimited" boolean DEFAULT false NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- Hand-added: the row every existing org and the policy default point at, inserted before
-- the foreign keys below validate. Unlimited is resolved at read time, so it has no rows.
INSERT INTO "plans" ("key", "name", "description", "is_unlimited", "is_system") VALUES ('unlimited', 'Unlimited', 'Every tenant permission, including ones added by later deploys.', true, true);
--> statement-breakpoint
ALTER TABLE "platform_policy" ADD COLUMN "default_plan_key" text DEFAULT 'unlimited' NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "plan_key" text DEFAULT 'unlimited' NOT NULL;--> statement-breakpoint
ALTER TABLE "entitlement_adjustments" ADD CONSTRAINT "entitlement_adjustments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_permissions" ADD CONSTRAINT "plan_permissions_plan_key_plans_key_fk" FOREIGN KEY ("plan_key") REFERENCES "public"."plans"("key") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "entitlement_adjustments_uq" ON "entitlement_adjustments" USING btree ("organization_id","permission");--> statement-breakpoint
CREATE INDEX "entitlement_adjustments_expiry_idx" ON "entitlement_adjustments" USING btree ("expires_at") WHERE expires_at is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "plan_permissions_uq" ON "plan_permissions" USING btree ("plan_key","permission");--> statement-breakpoint
ALTER TABLE "platform_policy" ADD CONSTRAINT "platform_policy_default_plan_key_plans_key_fk" FOREIGN KEY ("default_plan_key") REFERENCES "public"."plans"("key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_plan_key_plans_key_fk" FOREIGN KEY ("plan_key") REFERENCES "public"."plans"("key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "platform_policy_default_plan_idx" ON "platform_policy" USING btree ("default_plan_key");--> statement-breakpoint
CREATE INDEX "organizations_plan_idx" ON "organizations" USING btree ("plan_key");