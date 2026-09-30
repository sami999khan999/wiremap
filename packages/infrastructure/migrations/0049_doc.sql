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
CREATE UNIQUE INDEX "doc_spaces_slug_uq" ON "doc_spaces" USING btree ("organization_id","slug");