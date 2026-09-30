CREATE TABLE "doc_space_grants" (
	"id" uuid PRIMARY KEY NOT NULL,
	"space_id" uuid NOT NULL,
	"grantee_organization_id" uuid,
	"grantee_user_id" uuid,
	"grantee_plan_key" text,
	"reason" text NOT NULL,
	"expires_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "doc_space_grants_one_grantee_ck" CHECK (num_nonnulls("doc_space_grants"."grantee_organization_id", "doc_space_grants"."grantee_user_id", "doc_space_grants"."grantee_plan_key") = 1),
	CONSTRAINT "doc_space_grants_reason_ck" CHECK (char_length("doc_space_grants"."reason") between 1 and 500)
);
--> statement-breakpoint
ALTER TABLE "doc_space_grants" ADD CONSTRAINT "doc_space_grants_grantee_organization_id_organizations_id_fk" FOREIGN KEY ("grantee_organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doc_space_grants" ADD CONSTRAINT "doc_space_grants_grantee_user_id_users_id_fk" FOREIGN KEY ("grantee_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doc_space_grants" ADD CONSTRAINT "doc_space_grants_grantee_plan_key_plans_key_fk" FOREIGN KEY ("grantee_plan_key") REFERENCES "public"."plans"("key") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "doc_space_grants_organization_uq" ON "doc_space_grants" USING btree ("space_id","grantee_organization_id") WHERE "doc_space_grants"."grantee_organization_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "doc_space_grants_user_uq" ON "doc_space_grants" USING btree ("space_id","grantee_user_id") WHERE "doc_space_grants"."grantee_user_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "doc_space_grants_plan_uq" ON "doc_space_grants" USING btree ("space_id","grantee_plan_key") WHERE "doc_space_grants"."grantee_plan_key" is not null;--> statement-breakpoint
CREATE INDEX "doc_space_grants_organization_fk_idx" ON "doc_space_grants" USING btree ("grantee_organization_id");--> statement-breakpoint
CREATE INDEX "doc_space_grants_user_fk_idx" ON "doc_space_grants" USING btree ("grantee_user_id");--> statement-breakpoint
CREATE INDEX "doc_space_grants_plan_fk_idx" ON "doc_space_grants" USING btree ("grantee_plan_key");