-- Every tenant-owned table becomes a tenant partition first. Seven tables take
-- PARTITION BY LIST ("organization_id"), and the three with a time column take
-- PARTITION BY RANGE under each tenant — declared by TenantPartitionSeed, which
-- migrate.ts runs for every organization the moment this file has been applied.
--
-- This migration creates the partitioned **parents only**. One implementation creates
-- partitions; a SQL copy of it here would be a second one that drifts.
--
-- It drops and recreates in place, which the kit can do because it ships no rows in
-- these tables. A deployment that holds rows copies into a new parent and swaps the
-- two under a lock — see packages/infrastructure/docs/reference/partitions.md.
--
-- `messages_client_uq` does not come back. A unique index on a partitioned table has to
-- carry every partition key, and with "created_at" in it every retried send inserts a
-- second row instead of colliding. The dedupe is a Redis SET .. EX .. NX now.
DROP TABLE IF EXISTS "messages" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "conversation_members" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "conversations" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "notifications" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "notification_preferences" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "document_chunks" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "activity_log" CASCADE;--> statement-breakpoint

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
CREATE INDEX "activity_log_org_time_idx" ON "activity_log" USING btree ("organization_id","occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "activity_log_replay_idx" ON "activity_log" USING btree ("occurred_at","id");--> statement-breakpoint

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
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notifications_inbox_idx" ON "notifications" USING btree ("organization_id","user_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "notifications_unread_idx" ON "notifications" USING btree ("organization_id","user_id") WHERE read_at is null;--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_dedupe_uq" ON "notifications" USING btree ("organization_id","user_id","event_id","kind","created_at");--> statement-breakpoint
CREATE INDEX "notifications_subject_idx" ON "notifications" USING btree ("organization_id","user_id","kind","subject_id") WHERE read_at is null and subject_id is not null;--> statement-breakpoint
CREATE INDEX "notifications_user_fk_idx" ON "notifications" USING btree ("user_id");--> statement-breakpoint

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
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "notification_preferences_uq" ON "notification_preferences" USING btree ("organization_id","user_id","category","channel");--> statement-breakpoint
CREATE INDEX "notification_preferences_user_fk_idx" ON "notification_preferences" USING btree ("user_id");--> statement-breakpoint

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
ALTER TABLE "document_chunks" ADD CONSTRAINT "document_chunks_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "document_chunks_source_idx" ON "document_chunks" USING btree ("organization_id","source_id");--> statement-breakpoint
CREATE INDEX "document_chunks_goal_idx" ON "document_chunks" USING btree ("organization_id","goal_id");--> statement-breakpoint
CREATE INDEX "document_chunks_goal_null_idx" ON "document_chunks" USING btree ("organization_id","id") WHERE "document_chunks"."goal_id" is null;--> statement-breakpoint
CREATE INDEX "document_chunks_embedding_idx" ON "document_chunks" USING hnsw ("embedding" vector_cosine_ops) WITH (m=16,ef_construction=64);--> statement-breakpoint

CREATE TABLE "conversations" (
	"id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"title" text,
	"direct_key" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_message_at" timestamp with time zone,
	"last_message_id" uuid,
	CONSTRAINT "conversations_id_organization_id_pk" PRIMARY KEY("id","organization_id")
) PARTITION BY LIST ("organization_id");
--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "conversations_direct_uq" ON "conversations" USING btree ("organization_id","direct_key") WHERE direct_key is not null;--> statement-breakpoint
CREATE INDEX "conversations_recent_idx" ON "conversations" USING btree ("organization_id","last_message_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint

CREATE TABLE "conversation_members" (
	"id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_read_at" timestamp with time zone,
	"last_read_message_id" uuid,
	"muted_at" timestamp with time zone,
	CONSTRAINT "conversation_members_id_organization_id_pk" PRIMARY KEY("id","organization_id")
) PARTITION BY LIST ("organization_id");
--> statement-breakpoint
ALTER TABLE "conversation_members" ADD CONSTRAINT "conversation_members_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_members" ADD CONSTRAINT "conversation_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_members" ADD CONSTRAINT "conversation_members_conversation_fk" FOREIGN KEY ("conversation_id","organization_id") REFERENCES "public"."conversations"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "conversation_members_uq" ON "conversation_members" USING btree ("organization_id","conversation_id","user_id");--> statement-breakpoint
CREATE INDEX "conversation_members_mine_idx" ON "conversation_members" USING btree ("organization_id","user_id","last_read_at");--> statement-breakpoint
CREATE INDEX "conversation_members_conversation_fk_idx" ON "conversation_members" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "conversation_members_user_fk_idx" ON "conversation_members" USING btree ("user_id");--> statement-breakpoint

CREATE TABLE "messages" (
	"id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"author_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"body" text NOT NULL,
	"edited_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "messages_id_organization_id_created_at_pk" PRIMARY KEY("id","organization_id","created_at")
) PARTITION BY LIST ("organization_id");
--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_fk" FOREIGN KEY ("conversation_id","organization_id") REFERENCES "public"."conversations"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "messages_keyset_idx" ON "messages" USING btree ("organization_id","conversation_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "messages_conversation_fk_idx" ON "messages" USING btree ("conversation_id");
