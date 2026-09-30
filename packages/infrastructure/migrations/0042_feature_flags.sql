CREATE TABLE "feature_flag_organizations" (
	"organization_id" uuid NOT NULL,
	"flag_key" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "feature_flags" (
	"key" text PRIMARY KEY NOT NULL,
	"is_enabled" boolean DEFAULT false NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "feature_flag_organizations" ADD CONSTRAINT "feature_flag_organizations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feature_flag_organizations" ADD CONSTRAINT "feature_flag_organizations_flag_key_feature_flags_key_fk" FOREIGN KEY ("flag_key") REFERENCES "public"."feature_flags"("key") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "feature_flag_organizations_uq" ON "feature_flag_organizations" USING btree ("organization_id","flag_key");--> statement-breakpoint
CREATE INDEX "feature_flag_organizations_flag_idx" ON "feature_flag_organizations" USING btree ("flag_key");