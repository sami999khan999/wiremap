-- The platform tier is an organization, so a platform grant rides the roles and
-- memberships every other grant does — no env list, no flag on `users`, no second
-- permission system. `pnpm db:seed` marks the `loadbearing` organization.
--
-- Safe on a populated table: a `boolean NOT NULL DEFAULT false` needs no rewrite and no
-- backfill, which is why this one column is not the three-statement shape docs/setup/13
-- describes for a NOT NULL with no default.
ALTER TABLE "organizations" ADD COLUMN "is_platform" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- Partial, so it constrains only the true rows: at most one platform tier, and any
-- number of ordinary tenants. Without `WHERE`, the second tenant of any kind collides.
--
-- The de-dup §20 asks for, and it is not decoration: the column is added `false` above,
-- so a fresh deploy has nothing to collide on — but a database where somebody marked two
-- rows by hand would abort the migration halfway through. Nothing is deleted; the flag is
-- cleared, and `pnpm db:seed` marks the right one on the next run.
UPDATE "organizations" SET "is_platform" = false WHERE "is_platform";--> statement-breakpoint
CREATE UNIQUE INDEX "organizations_platform_uq" ON "organizations" USING btree ("is_platform") WHERE is_platform;--> statement-breakpoint

-- `roles.scope` is a `text` column with a drizzle-side enum rather than a Postgres one,
-- so widening it to admit `platform` is a type change with no DDL. Recorded here because
-- the schema changed and the migration would otherwise be silent about it.
SELECT 1;
