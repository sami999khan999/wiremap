DROP INDEX "permission_overrides_org_uq";--> statement-breakpoint
DROP INDEX "permission_overrides_goal_uq";--> statement-breakpoint
ALTER TABLE "permission_overrides" ADD COLUMN "expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "permission_overrides" ADD COLUMN "created_by" uuid;--> statement-breakpoint
ALTER TABLE "permission_overrides" ADD COLUMN "authority" text DEFAULT 'org' NOT NULL;--> statement-breakpoint
-- Hand-added: every grant must now lapse and carry a reason, so the CHECKs below would
-- refuse the rows that predate them. They get the maximum, 90 days, from this deploy.
-- The rebuilt unique indexes only add `authority` to the key, so no existing row collides.
UPDATE "permission_overrides" SET "expires_at" = now() + interval '90 days', "reason" = coalesce("reason", 'Granted before overrides expired') WHERE "effect" = 'grant';--> statement-breakpoint
CREATE INDEX "permission_overrides_expiry_idx" ON "permission_overrides" USING btree ("expires_at") WHERE "permission_overrides"."expires_at" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "permission_overrides_org_uq" ON "permission_overrides" USING btree ("organization_id","user_id","permission","authority") WHERE "permission_overrides"."goal_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "permission_overrides_goal_uq" ON "permission_overrides" USING btree ("organization_id","user_id","goal_id","permission","authority") WHERE "permission_overrides"."goal_id" is not null;--> statement-breakpoint
ALTER TABLE "permission_overrides" ADD CONSTRAINT "permission_overrides_expiry_ck" CHECK (("permission_overrides"."effect" = 'grant' and "permission_overrides"."expires_at" is not null) or ("permission_overrides"."effect" = 'deny' and "permission_overrides"."expires_at" is null));--> statement-breakpoint
ALTER TABLE "permission_overrides" ADD CONSTRAINT "permission_overrides_reason_ck" CHECK ("permission_overrides"."effect" = 'deny' or "permission_overrides"."reason" is not null);--> statement-breakpoint
ALTER TABLE "permission_overrides" ADD CONSTRAINT "permission_overrides_authority_ck" CHECK ("permission_overrides"."authority" = 'org' or "permission_overrides"."effect" = 'deny');