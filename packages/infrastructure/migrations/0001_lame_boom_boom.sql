CREATE TABLE "document_chunks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"source_id" uuid NOT NULL,
	"source_type" text NOT NULL,
	"goal_id" uuid,
	"chunk_index" integer NOT NULL,
	"content" text NOT NULL,
	"embedding" vector(1536) NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "document_chunks_source_idx" ON "document_chunks" USING btree ("organization_id","source_id");--> statement-breakpoint
CREATE INDEX "document_chunks_goal_idx" ON "document_chunks" USING btree ("organization_id","goal_id");--> statement-breakpoint
CREATE INDEX "document_chunks_goal_null_idx" ON "document_chunks" USING btree ("organization_id","id") WHERE "document_chunks"."goal_id" is null;--> statement-breakpoint
CREATE INDEX "document_chunks_embedding_idx" ON "document_chunks" USING hnsw ("embedding" vector_cosine_ops) WITH (m=16,ef_construction=64);