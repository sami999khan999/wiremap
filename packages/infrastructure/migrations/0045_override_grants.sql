-- Hand-written, as `0039` is: this is data, not DDL. The seed grants the override keys on
-- tenants created from here on; this backfills the roles that already exist.
--
-- Selected by what a role holds rather than by its key, so a custom role built from
-- `admin` gets them too. A role that edits roles may review exceptions; a role that may
-- grant permissions may write them.
INSERT INTO "role_permissions" ("organization_id", "role_id", "permission")
SELECT r."organization_id", r."id", 'rbac.override.read'
FROM "roles" r
WHERE EXISTS (
  SELECT 1 FROM "role_permissions" existing
  WHERE existing."role_id" = r."id"
    AND existing."organization_id" = r."organization_id"
    AND existing."permission" = 'rbac.role.manage'
)
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO "role_permissions" ("organization_id", "role_id", "permission")
SELECT r."organization_id", r."id", p."permission"
FROM "roles" r
CROSS JOIN (VALUES ('rbac.override.read'), ('rbac.override.manage')) AS p("permission")
WHERE EXISTS (
  SELECT 1 FROM "role_permissions" existing
  WHERE existing."role_id" = r."id"
    AND existing."organization_id" = r."organization_id"
    AND existing."permission" = 'rbac.permission.grant'
)
ON CONFLICT DO NOTHING;
