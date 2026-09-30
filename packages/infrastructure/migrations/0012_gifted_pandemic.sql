-- Hand-edited: drizzle emits the two indexes only, and either one fails on a table that
-- already holds a duplicate. See docs/setup/13, "writing a unique-index migration".
DELETE FROM "accounts" a USING "accounts" b WHERE a."provider_id" = b."provider_id" AND a."account_id" = b."account_id" AND (a."created_at", a."id") > (b."created_at", b."id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "accounts_provider_account_uq" ON "accounts" USING btree ("provider_id","account_id");--> statement-breakpoint
DELETE FROM "two_factors" t WHERE t."id" <> (SELECT k."id" FROM "two_factors" k WHERE k."user_id" = t."user_id" ORDER BY k."verified" DESC NULLS LAST, k."id" DESC LIMIT 1);--> statement-breakpoint
DROP INDEX IF EXISTS "two_factors_user_idx";--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "two_factors_user_idx" ON "two_factors" USING btree ("user_id");
