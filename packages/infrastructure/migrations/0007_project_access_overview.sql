-- The org-wide key behind the access overview, for the roles that already administer every
-- project. Data only; the seed grants it to organizations founded from now on.
INSERT INTO "role_permissions" ("organization_id", "role_id", "permission")
SELECT "r"."organization_id", "r"."id", 'project.access.overview'
FROM "roles" "r"
WHERE "r"."key" IN ('owner', 'admin', 'platform_admin')
ON CONFLICT DO NOTHING;
