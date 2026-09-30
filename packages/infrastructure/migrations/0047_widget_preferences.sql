CREATE TABLE "widget_preferences" (
	"id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid,
	"widget" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "widget_preferences_id_organization_id_pk" PRIMARY KEY("id","organization_id")
) PARTITION BY LIST ("organization_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "widget_preferences_user_uq" ON "widget_preferences" USING btree ("organization_id","user_id","widget") WHERE "widget_preferences"."user_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "widget_preferences_default_uq" ON "widget_preferences" USING btree ("organization_id","widget") WHERE "widget_preferences"."user_id" is null;--> statement-breakpoint
CREATE INDEX "widget_preferences_user_fk_idx" ON "widget_preferences" USING btree ("user_id");