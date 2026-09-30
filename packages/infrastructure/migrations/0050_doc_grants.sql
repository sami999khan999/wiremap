-- Hand-written, as `0048` is: this is data, not DDL. The seed grants the doc keys on
-- tenants created from here on; this backfills the roles that already exist.
--
-- Selected by what a role holds rather than by its key, so a custom role built from
-- `member` or `admin` gets the same. Anyone who can see the member list can read the
-- docs; a role that edits roles may write, publish and arrange them.
INSERT INTO "role_permissions" ("organization_id", "role_id", "permission")
SELECT r."organization_id", r."id", 'doc.page.read'
FROM "roles" r
WHERE EXISTS (
  SELECT 1 FROM "role_permissions" existing
  WHERE existing."role_id" = r."id"
    AND existing."organization_id" = r."organization_id"
    AND existing."permission" = 'member.read'
)
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO "role_permissions" ("organization_id", "role_id", "permission")
SELECT r."organization_id", r."id", p."permission"
FROM "roles" r
CROSS JOIN (
  VALUES ('doc.page.read'), ('doc.page.write'), ('doc.page.publish'), ('doc.space.manage')
) AS p("permission")
WHERE EXISTS (
  SELECT 1 FROM "role_permissions" existing
  WHERE existing."role_id" = r."id"
    AND existing."organization_id" = r."organization_id"
    AND existing."permission" = 'rbac.role.manage'
)
ON CONFLICT DO NOTHING;
