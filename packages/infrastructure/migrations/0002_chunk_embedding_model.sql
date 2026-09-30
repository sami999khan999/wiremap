-- Hand-added note: a chunk written before this migration has a vector and no model, so
-- every search skips it until `pnpm ai:reindex` re-embeds it under the active one.
ALTER TABLE "document_chunks" ALTER COLUMN "embedding" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "document_chunks" ADD COLUMN "embedding_model" text;--> statement-breakpoint
ALTER TABLE "document_chunks" ADD COLUMN "search" "tsvector" GENERATED ALWAYS AS (to_tsvector('simple', content)) STORED;--> statement-breakpoint
CREATE INDEX "document_chunks_search_idx" ON "document_chunks" USING gin ("search");