-- Hand-written, as `0018` is: this is data, not DDL. The seed grants
-- `analytics.activity.read` to `owner` and `admin` on tenants created from here on; this
-- backfills the roles that already exist, including a custom role built from `admin`.
--
-- Selected by what a role holds rather than by its key: `owner` holds explicit rows
-- resolved at seed time, so the test that finds an administrator finds it too.
INSERT INTO "role_permissions" ("organization_id", "role_id", "permission")
SELECT r."organization_id", r."id", 'analytics.activity.read'
FROM "roles" r
WHERE EXISTS (
  SELECT 1 FROM "role_permissions" existing
  WHERE existing."role_id" = r."id"
    AND existing."organization_id" = r."organization_id"
    AND existing."permission" = 'rbac.role.manage'
)
ON CONFLICT DO NOTHING;
