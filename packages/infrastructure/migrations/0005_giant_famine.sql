-- Hand-edited after `drizzle-kit generate`: each CREATE UNIQUE INDEX below is preceded
-- by the delete that makes it apply. A unique index over existing duplicates fails, and
-- a migration that fails halfway is worse than one that decides what to keep.
--
-- The rule everywhere here is "keep the oldest row, drop the rest", chosen on
-- `(created_at, id)` so it is deterministic. See docs/setup/13.

DROP INDEX "permission_overrides_uq";--> statement-breakpoint
DROP INDEX "goal_members_uq";--> statement-breakpoint
DROP INDEX "role_permissions_uq";--> statement-breakpoint

-- `permission_overrides_uq` was `(user_id, goal_id, permission)` over a nullable
-- `goal_id`. NULLs are distinct in a unique index, so every org-scope override was
-- exempt from it: unlimited duplicates, and a `grant` and a `deny` for one permission
-- side by side. `CapabilitySet.can()` resolves that pair to deny either way, so the
-- damage is silent accumulation rather than a wrong answer.
DELETE FROM "permission_overrides" a
USING "permission_overrides" b
WHERE a."organization_id" = b."organization_id"
  AND a."user_id" = b."user_id"
  AND a."permission" = b."permission"
  AND a."goal_id" IS NULL
  AND b."goal_id" IS NULL
  AND (a."created_at", a."id") > (b."created_at", b."id");--> statement-breakpoint

CREATE UNIQUE INDEX "permission_overrides_org_uq" ON "permission_overrides" USING btree ("organization_id","user_id","permission") WHERE "permission_overrides"."goal_id" is null;--> statement-breakpoint

DELETE FROM "permission_overrides" a
USING "permission_overrides" b
WHERE a."organization_id" = b."organization_id"
  AND a."user_id" = b."user_id"
  AND a."goal_id" = b."goal_id"
  AND a."permission" = b."permission"
  AND a."goal_id" IS NOT NULL
  AND (a."created_at", a."id") > (b."created_at", b."id");--> statement-breakpoint

CREATE UNIQUE INDEX "permission_overrides_goal_uq" ON "permission_overrides" USING btree ("organization_id","user_id","goal_id","permission") WHERE "permission_overrides"."goal_id" is not null;--> statement-breakpoint

-- The three below only gain a leading `organization_id`, so they cannot admit a row the
-- old index admitted — every tuple that was unique stays unique. The de-dup is here
-- because the old index was dropped above and nothing enforces it in between.
DELETE FROM "goal_members" a
USING "goal_members" b
WHERE a."organization_id" = b."organization_id"
  AND a."goal_id" = b."goal_id"
  AND a."user_id" = b."user_id"
  AND a."role_id" = b."role_id"
  AND (a."created_at", a."id") > (b."created_at", b."id");--> statement-breakpoint

CREATE UNIQUE INDEX "goal_members_uq" ON "goal_members" USING btree ("organization_id","goal_id","user_id","role_id");--> statement-breakpoint

-- `ctid`, because `role_permissions` is a pure join table with no id and no timestamp.
-- It is stable within one statement, which is all a de-dup needs.
DELETE FROM "role_permissions" a
USING "role_permissions" b
WHERE a."organization_id" = b."organization_id"
  AND a."role_id" = b."role_id"
  AND a."permission" = b."permission"
  AND a."ctid" > b."ctid";--> statement-breakpoint

CREATE UNIQUE INDEX "role_permissions_uq" ON "role_permissions" USING btree ("organization_id","role_id","permission");
