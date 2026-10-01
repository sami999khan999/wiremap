ALTER TABLE "doc_pages" ADD COLUMN "access" jsonb;--> statement-breakpoint
ALTER TABLE "doc_spaces" ADD COLUMN "access" jsonb;--> statement-breakpoint
ALTER TABLE "doc_spaces" ADD COLUMN "repository_url" text;