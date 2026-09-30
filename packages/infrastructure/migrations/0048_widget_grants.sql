-- Hand-written, as `0045` is: this is data, not DDL. The seed grants `widget.default.manage`
-- on tenants created from here on; this backfills the roles that already exist.
--
-- Selected by what a role holds rather than by its key, so a custom role built from `admin`
-- gets it too: a role that edits roles may decide which cards everyone sees.
INSERT INTO "role_permissions" ("organization_id", "role_id", "permission")
SELECT r."organization_id", r."id", 'widget.default.manage'
FROM "roles" r
WHERE EXISTS (
  SELECT 1 FROM "role_permissions" existing
  WHERE existing."role_id" = r."id"
    AND existing."organization_id" = r."organization_id"
    AND existing."permission" = 'rbac.role.manage'
)
ON CONFLICT DO NOTHING;
