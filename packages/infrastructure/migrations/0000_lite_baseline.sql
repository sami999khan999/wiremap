-- Hand-written: the lite baseline squashes the big kit's 0000–0051 into one file. Below this
-- block it is drizzle-kit's output with `partition-ddl.ts`'s PARTITION BY clauses. Two things
-- drizzle cannot write are here: the extensions the schema needs, and at the end the one
-- seeded row and the role's timeout floor. `postgres.init.sql` creates the same extensions
-- on a compose volume; these make a managed Postgres work too.
CREATE EXTENSION IF NOT EXISTS vector;--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
CREATE TABLE "activity_log" (
	"id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"actor_id" uuid NOT NULL,
	"action" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "activity_log_id_organization_id_occurred_at_pk" PRIMARY KEY("id","organization_id","occurred_at")
) PARTITION BY LIST ("organization_id");
--> statement-breakpoint
CREATE TABLE "api_keys" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"issuer_id" uuid NOT NULL,
	"prefix" text NOT NULL,
	"token_hash" text NOT NULL,
	"scopes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "partition_archive" (
	"organization_id" uuid NOT NULL,
	"table_name" text NOT NULL,
	"period" date NOT NULL,
	"object_key" text NOT NULL,
	"row_count" integer NOT NULL,
	"bytes" bigint NOT NULL,
	"checksum" text NOT NULL,
	"action_counts" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"projected_at" timestamp with time zone,
	"archived_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "partition_archive_organization_id_table_name_period_pk" PRIMARY KEY("organization_id","table_name","period")
);
--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" uuid NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"token" text NOT NULL,
	"user_id" uuid NOT NULL,
	"active_organization_id" uuid NOT NULL,
	"surface" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sessions_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "two_factors" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"secret" text NOT NULL,
	"backup_codes" text NOT NULL,
	"verified" boolean DEFAULT false,
	"failed_verification_count" integer DEFAULT 0,
	"locked_until" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"two_factor_enabled" boolean DEFAULT false,
	"locale" text DEFAULT 'en' NOT NULL,
	"timezone" text,
	"suspended_at" timestamp with time zone,
	"last_active_organization_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verifications" (
	"id" uuid PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "doc_pages" (
	"id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"space_id" uuid NOT NULL,
	"parent_id" uuid,
	"kind" text NOT NULL,
	"slug" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"icon" text,
	"url" text,
	"title" text NOT NULL,
	"description" text,
	"markdown" text DEFAULT '' NOT NULL,
	"draft_version" integer DEFAULT 1 NOT NULL,
	"updated_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_title" text,
	"published_description" text,
	"published_markdown" text,
	"published_html" text,
	"published_toc" jsonb,
	"published_draft_version" integer,
	"published_by" uuid,
	"published_at" timestamp with time zone,
	"revision_no" integer DEFAULT 0 NOT NULL,
	"renderer_version" integer,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "doc_pages_id_organization_id_pk" PRIMARY KEY("id","organization_id")
) PARTITION BY LIST ("organization_id");
--> statement-breakpoint
CREATE TABLE "doc_revision" (
	"id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"space_id" uuid NOT NULL,
	"page_id" uuid NOT NULL,
	"revision_no" integer NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"markdown" text NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "doc_revision_id_organization_id_created_at_pk" PRIMARY KEY("id","organization_id","created_at")
) PARTITION BY LIST ("organization_id");
--> statement-breakpoint
CREATE TABLE "doc_sections" (
	"id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"space_id" uuid NOT NULL,
	"page_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"anchor" text,
	"heading" text,
	"body" text NOT NULL,
	"search" "tsvector" GENERATED ALWAYS AS (setweight(to_tsvector('simple', coalesce(heading, '')), 'A') || setweight(to_tsvector('simple', body), 'B')) STORED,
	CONSTRAINT "doc_sections_id_organization_id_pk" PRIMARY KEY("id","organization_id")
) PARTITION BY LIST ("organization_id");
--> statement-breakpoint
CREATE TABLE "doc_spaces" (
	"id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"icon" text,
	"audience" text DEFAULT 'members' NOT NULL,
	"theme" text,
	"position" integer DEFAULT 0 NOT NULL,
	"nav" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "doc_spaces_id_organization_id_pk" PRIMARY KEY("id","organization_id")
) PARTITION BY LIST ("organization_id");
--> statement-breakpoint
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
CREATE TABLE "invitations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"email" text NOT NULL,
	"role_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"invited_by" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_preferences" (
	"id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"category" text NOT NULL,
	"channel" text NOT NULL,
	"mode" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_preferences_id_organization_id_pk" PRIMARY KEY("id","organization_id")
) PARTITION BY LIST ("organization_id");
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"category" text NOT NULL,
	"params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"link" text,
	"subject_id" text,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notifications_id_organization_id_created_at_pk" PRIMARY KEY("id","organization_id","created_at")
) PARTITION BY LIST ("organization_id");
--> statement-breakpoint
CREATE TABLE "outbox_event" (
	"id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"actor_id" uuid NOT NULL,
	"name" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone,
	"claimed_until" timestamp with time zone,
	CONSTRAINT "outbox_event_id_occurred_at_pk" PRIMARY KEY("id","occurred_at")
) PARTITION BY RANGE ("occurred_at");
--> statement-breakpoint
CREATE TABLE "platform_policy" (
	"id" smallint PRIMARY KEY NOT NULL,
	"projection_enabled" boolean DEFAULT true NOT NULL,
	"replica_reads_enabled" boolean DEFAULT false NOT NULL,
	"move_grace_days" smallint,
	"default_plan_key" text DEFAULT 'unlimited' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platform_policy_singleton_ck" CHECK ("platform_policy"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE "goal_members" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"goal_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deactivated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"is_platform" boolean DEFAULT false NOT NULL,
	"plan_key" text DEFAULT 'unlimited' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "permission_overrides" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"goal_id" uuid,
	"permission" text NOT NULL,
	"effect" text NOT NULL,
	"reason" text,
	"expires_at" timestamp with time zone,
	"created_by" uuid,
	"authority" text DEFAULT 'org' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "permission_overrides_expiry_ck" CHECK (("permission_overrides"."effect" = 'grant' and "permission_overrides"."expires_at" is not null) or ("permission_overrides"."effect" = 'deny' and "permission_overrides"."expires_at" is null)),
	CONSTRAINT "permission_overrides_reason_ck" CHECK ("permission_overrides"."effect" = 'deny' or "permission_overrides"."reason" is not null),
	CONSTRAINT "permission_overrides_authority_ck" CHECK ("permission_overrides"."authority" = 'org' or "permission_overrides"."effect" = 'deny')
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
CREATE TABLE "role_permissions" (
	"organization_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	"permission" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"scope" text NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shard_assignments" (
	"shard_key" text PRIMARY KEY NOT NULL,
	"node" smallint DEFAULT 0 NOT NULL,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"moved_at" timestamp with time zone,
	"moving_to" smallint,
	"source_droppable_at" timestamp with time zone,
	"moved_from" smallint
);
--> statement-breakpoint
CREATE TABLE "spare_tenants" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_chunks" (
	"id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"source_id" uuid NOT NULL,
	"source_type" text NOT NULL,
	"goal_id" uuid,
	"chunk_index" integer NOT NULL,
	"content" text NOT NULL,
	"embedding" vector(1536) NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_chunks_id_organization_id_pk" PRIMARY KEY("id","organization_id")
) PARTITION BY LIST ("organization_id");
--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_issuer_id_users_id_fk" FOREIGN KEY ("issuer_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_active_organization_id_organizations_id_fk" FOREIGN KEY ("active_organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "two_factors" ADD CONSTRAINT "two_factors_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_last_active_organization_id_organizations_id_fk" FOREIGN KEY ("last_active_organization_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doc_space_grants" ADD CONSTRAINT "doc_space_grants_grantee_organization_id_organizations_id_fk" FOREIGN KEY ("grantee_organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doc_space_grants" ADD CONSTRAINT "doc_space_grants_grantee_user_id_users_id_fk" FOREIGN KEY ("grantee_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doc_space_grants" ADD CONSTRAINT "doc_space_grants_grantee_plan_key_plans_key_fk" FOREIGN KEY ("grantee_plan_key") REFERENCES "public"."plans"("key") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entitlement_adjustments" ADD CONSTRAINT "entitlement_adjustments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feature_flag_organizations" ADD CONSTRAINT "feature_flag_organizations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feature_flag_organizations" ADD CONSTRAINT "feature_flag_organizations_flag_key_feature_flags_key_fk" FOREIGN KEY ("flag_key") REFERENCES "public"."feature_flags"("key") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_invited_by_users_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_policy" ADD CONSTRAINT "platform_policy_default_plan_key_plans_key_fk" FOREIGN KEY ("default_plan_key") REFERENCES "public"."plans"("key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goal_members" ADD CONSTRAINT "goal_members_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goal_members" ADD CONSTRAINT "goal_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goal_members" ADD CONSTRAINT "goal_members_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_plan_key_plans_key_fk" FOREIGN KEY ("plan_key") REFERENCES "public"."plans"("key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "permission_overrides" ADD CONSTRAINT "permission_overrides_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "permission_overrides" ADD CONSTRAINT "permission_overrides_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_permissions" ADD CONSTRAINT "plan_permissions_plan_key_plans_key_fk" FOREIGN KEY ("plan_key") REFERENCES "public"."plans"("key") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roles" ADD CONSTRAINT "roles_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activity_log_org_time_idx" ON "activity_log" USING btree ("organization_id","occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "activity_log_replay_idx" ON "activity_log" USING btree ("occurred_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "api_keys_hash_uq" ON "api_keys" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "api_keys_prefix_idx" ON "api_keys" USING btree ("prefix");--> statement-breakpoint
CREATE INDEX "api_keys_issuer_idx" ON "api_keys" USING btree ("organization_id","issuer_id");--> statement-breakpoint
CREATE INDEX "api_keys_issuer_fk_idx" ON "api_keys" USING btree ("issuer_id");--> statement-breakpoint
CREATE INDEX "partition_archive_unprojected_idx" ON "partition_archive" USING btree ("table_name","period") WHERE projected_at is null;--> statement-breakpoint
CREATE INDEX "partition_archive_deleted_idx" ON "partition_archive" USING btree ("deleted_at") WHERE deleted_at is not null;--> statement-breakpoint
CREATE INDEX "accounts_user_idx" ON "accounts" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_provider_account_uq" ON "accounts" USING btree ("provider_id","account_id");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_organization_idx" ON "sessions" USING btree ("active_organization_id");--> statement-breakpoint
CREATE INDEX "sessions_expires_idx" ON "sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "sessions_user_surface_idx" ON "sessions" USING btree ("user_id","surface");--> statement-breakpoint
CREATE UNIQUE INDEX "two_factors_user_idx" ON "two_factors" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "users_last_active_organization_idx" ON "users" USING btree ("last_active_organization_id");--> statement-breakpoint
CREATE INDEX "verifications_identifier_idx" ON "verifications" USING btree ("identifier");--> statement-breakpoint
CREATE INDEX "verifications_expires_idx" ON "verifications" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "doc_pages_child_slug_uq" ON "doc_pages" USING btree ("organization_id","space_id","parent_id","slug") WHERE "doc_pages"."parent_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "doc_pages_root_slug_uq" ON "doc_pages" USING btree ("organization_id","space_id","slug") WHERE "doc_pages"."parent_id" is null;--> statement-breakpoint
CREATE INDEX "doc_pages_space_idx" ON "doc_pages" USING btree ("organization_id","space_id","parent_id","position");--> statement-breakpoint
CREATE INDEX "doc_pages_space_fk_idx" ON "doc_pages" USING btree ("space_id");--> statement-breakpoint
CREATE INDEX "doc_pages_parent_fk_idx" ON "doc_pages" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "doc_pages_title_trgm_idx" ON "doc_pages" USING gin ("published_title" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "doc_revision_page_idx" ON "doc_revision" USING btree ("organization_id","page_id","revision_no" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "doc_revision_page_fk_idx" ON "doc_revision" USING btree ("page_id");--> statement-breakpoint
CREATE INDEX "doc_revision_space_fk_idx" ON "doc_revision" USING btree ("space_id");--> statement-breakpoint
CREATE INDEX "doc_sections_page_idx" ON "doc_sections" USING btree ("organization_id","page_id","position");--> statement-breakpoint
CREATE INDEX "doc_sections_page_fk_idx" ON "doc_sections" USING btree ("page_id");--> statement-breakpoint
CREATE INDEX "doc_sections_space_fk_idx" ON "doc_sections" USING btree ("space_id");--> statement-breakpoint
CREATE INDEX "doc_sections_search_idx" ON "doc_sections" USING gin ("search");--> statement-breakpoint
CREATE UNIQUE INDEX "doc_spaces_slug_uq" ON "doc_spaces" USING btree ("organization_id","slug");--> statement-breakpoint
CREATE UNIQUE INDEX "doc_space_grants_organization_uq" ON "doc_space_grants" USING btree ("space_id","grantee_organization_id") WHERE "doc_space_grants"."grantee_organization_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "doc_space_grants_user_uq" ON "doc_space_grants" USING btree ("space_id","grantee_user_id") WHERE "doc_space_grants"."grantee_user_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "doc_space_grants_plan_uq" ON "doc_space_grants" USING btree ("space_id","grantee_plan_key") WHERE "doc_space_grants"."grantee_plan_key" is not null;--> statement-breakpoint
CREATE INDEX "doc_space_grants_organization_fk_idx" ON "doc_space_grants" USING btree ("grantee_organization_id");--> statement-breakpoint
CREATE INDEX "doc_space_grants_user_fk_idx" ON "doc_space_grants" USING btree ("grantee_user_id");--> statement-breakpoint
CREATE INDEX "doc_space_grants_plan_fk_idx" ON "doc_space_grants" USING btree ("grantee_plan_key");--> statement-breakpoint
CREATE UNIQUE INDEX "entitlement_adjustments_uq" ON "entitlement_adjustments" USING btree ("organization_id","permission");--> statement-breakpoint
CREATE INDEX "entitlement_adjustments_expiry_idx" ON "entitlement_adjustments" USING btree ("expires_at") WHERE expires_at is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "feature_flag_organizations_uq" ON "feature_flag_organizations" USING btree ("organization_id","flag_key");--> statement-breakpoint
CREATE INDEX "feature_flag_organizations_flag_idx" ON "feature_flag_organizations" USING btree ("flag_key");--> statement-breakpoint
CREATE UNIQUE INDEX "invitations_email_uq" ON "invitations" USING btree ("organization_id","email");--> statement-breakpoint
CREATE UNIQUE INDEX "invitations_token_uq" ON "invitations" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "invitations_email_idx" ON "invitations" USING btree ("email");--> statement-breakpoint
CREATE INDEX "invitations_role_idx" ON "invitations" USING btree ("role_id");--> statement-breakpoint
CREATE INDEX "invitations_inviter_idx" ON "invitations" USING btree ("invited_by");--> statement-breakpoint
CREATE INDEX "invitations_expires_idx" ON "invitations" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_preferences_uq" ON "notification_preferences" USING btree ("organization_id","user_id","category","channel");--> statement-breakpoint
CREATE INDEX "notification_preferences_user_fk_idx" ON "notification_preferences" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "notifications_inbox_idx" ON "notifications" USING btree ("organization_id","user_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "notifications_unread_idx" ON "notifications" USING btree ("organization_id","user_id") WHERE read_at is null;--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_dedupe_uq" ON "notifications" USING btree ("organization_id","user_id","event_id","kind","created_at");--> statement-breakpoint
CREATE INDEX "notifications_subject_idx" ON "notifications" USING btree ("organization_id","user_id","kind","subject_id") WHERE read_at is null and subject_id is not null;--> statement-breakpoint
CREATE INDEX "notifications_user_fk_idx" ON "notifications" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "outbox_event_pending_idx" ON "outbox_event" USING btree ("occurred_at","id") WHERE published_at is null;--> statement-breakpoint
CREATE INDEX "outbox_event_published_idx" ON "outbox_event" USING btree ("published_at") WHERE published_at is not null;--> statement-breakpoint
CREATE INDEX "outbox_event_org_idx" ON "outbox_event" USING btree ("organization_id","occurred_at");--> statement-breakpoint
CREATE INDEX "platform_policy_default_plan_idx" ON "platform_policy" USING btree ("default_plan_key");--> statement-breakpoint
CREATE UNIQUE INDEX "goal_members_uq" ON "goal_members" USING btree ("organization_id","goal_id","user_id","role_id");--> statement-breakpoint
CREATE INDEX "goal_members_user_idx" ON "goal_members" USING btree ("organization_id","user_id");--> statement-breakpoint
CREATE INDEX "goal_members_user_fk_idx" ON "goal_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "goal_members_goal_idx" ON "goal_members" USING btree ("goal_id");--> statement-breakpoint
CREATE INDEX "goal_members_role_idx" ON "goal_members" USING btree ("role_id");--> statement-breakpoint
CREATE UNIQUE INDEX "memberships_uq" ON "memberships" USING btree ("organization_id","user_id");--> statement-breakpoint
CREATE INDEX "memberships_active_idx" ON "memberships" USING btree ("organization_id","deactivated_at");--> statement-breakpoint
CREATE INDEX "memberships_user_idx" ON "memberships" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "memberships_role_idx" ON "memberships" USING btree ("role_id");--> statement-breakpoint
CREATE UNIQUE INDEX "organizations_slug_uq" ON "organizations" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "organizations_platform_uq" ON "organizations" USING btree ("is_platform") WHERE is_platform;--> statement-breakpoint
CREATE INDEX "organizations_plan_idx" ON "organizations" USING btree ("plan_key");--> statement-breakpoint
CREATE INDEX "permission_overrides_user_idx" ON "permission_overrides" USING btree ("organization_id","user_id");--> statement-breakpoint
CREATE INDEX "permission_overrides_user_fk_idx" ON "permission_overrides" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "permission_overrides_goal_idx" ON "permission_overrides" USING btree ("goal_id");--> statement-breakpoint
CREATE UNIQUE INDEX "permission_overrides_org_uq" ON "permission_overrides" USING btree ("organization_id","user_id","permission","authority") WHERE "permission_overrides"."goal_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "permission_overrides_goal_uq" ON "permission_overrides" USING btree ("organization_id","user_id","goal_id","permission","authority") WHERE "permission_overrides"."goal_id" is not null;--> statement-breakpoint
CREATE INDEX "permission_overrides_expiry_idx" ON "permission_overrides" USING btree ("expires_at") WHERE "permission_overrides"."expires_at" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "plan_permissions_uq" ON "plan_permissions" USING btree ("plan_key","permission");--> statement-breakpoint
CREATE UNIQUE INDEX "role_permissions_uq" ON "role_permissions" USING btree ("organization_id","role_id","permission");--> statement-breakpoint
CREATE INDEX "role_permissions_role_fk_idx" ON "role_permissions" USING btree ("role_id");--> statement-breakpoint
CREATE UNIQUE INDEX "roles_key_uq" ON "roles" USING btree ("organization_id","key");--> statement-breakpoint
CREATE INDEX "roles_organization_idx" ON "roles" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "shard_assignments_node_idx" ON "shard_assignments" USING btree ("node");--> statement-breakpoint
CREATE INDEX "shard_assignments_droppable_idx" ON "shard_assignments" USING btree ("source_droppable_at") WHERE source_droppable_at is not null;--> statement-breakpoint
CREATE INDEX "spare_tenants_created_idx" ON "spare_tenants" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "document_chunks_source_idx" ON "document_chunks" USING btree ("organization_id","source_id");--> statement-breakpoint
CREATE INDEX "document_chunks_goal_idx" ON "document_chunks" USING btree ("organization_id","goal_id");--> statement-breakpoint
CREATE INDEX "document_chunks_goal_null_idx" ON "document_chunks" USING btree ("organization_id","id") WHERE "document_chunks"."goal_id" is null;--> statement-breakpoint
CREATE INDEX "document_chunks_embedding_idx" ON "document_chunks" USING hnsw ("embedding" vector_cosine_ops) WITH (m=16,ef_construction=64);--> statement-breakpoint
-- Hand-written: the plan every organization and the policy default point at. Unlimited is
-- resolved at read time, so it has no `plan_permissions` rows.
INSERT INTO "plans" ("key", "name", "description", "is_unlimited", "is_system") VALUES ('unlimited', 'Unlimited', 'Every tenant permission, including ones added by later deploys.', true, true);--> statement-breakpoint
-- Hand-written: the timeout floor that survives a transaction pooler, on the role this runs
-- as, which must be the role the application connects as. See docs/scale/pgbouncer.md.
ALTER ROLE CURRENT_USER SET statement_timeout = '30s';--> statement-breakpoint
-- The forgotten-`await` guard: a transaction left open holds a connection for every other client.
ALTER ROLE CURRENT_USER SET idle_in_transaction_session_timeout = '60s';--> statement-breakpoint
-- Short on purpose: partition DDL takes ACCESS EXCLUSIVE, and a drop that waits queues every reader.
ALTER ROLE CURRENT_USER SET lock_timeout = '10s';
