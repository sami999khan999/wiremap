-- Hand-written: drizzle-kit writes DDL, and this is data. The seed grants permissions to
-- *system* roles on tenants created from here on; this backfills the ones that already
-- exist, including any custom role a customer built from `admin` or `member`.
--
-- It is also the release switch. Until this runs, `messaging.conversation.read` is held
-- by nobody, the nav entry is hidden for everyone and every procedure returns FORBIDDEN.

INSERT INTO "role_permissions" ("organization_id", "role_id", "permission")
SELECT r."organization_id", r."id", k."permission"
FROM "roles" r
CROSS JOIN (VALUES
  ('messaging.conversation.read'),
  ('messaging.conversation.create'),
  ('messaging.message.send'),
  ('messaging.message.update')
) AS k("permission")
-- Selected by the rows a role holds rather than by its key, as `0016` is: `owner` is
-- seeded with every permission resolved at seed time, so it holds explicit rows and a
-- key-based filter would have skipped it. Not `guest`, which holds nothing.
WHERE EXISTS (
  SELECT 1 FROM "role_permissions" existing
  WHERE existing."role_id" = r."id"
    AND existing."organization_id" = r."organization_id"
    AND existing."permission" = 'member.read'
)
ON CONFLICT DO NOTHING;

-- Administration is narrower, and the same test that separates it in the seed separates
-- it here: a role that can already manage roles can manage conversations.
INSERT INTO "role_permissions" ("organization_id", "role_id", "permission")
SELECT r."organization_id", r."id", 'messaging.conversation.manage'
FROM "roles" r
WHERE EXISTS (
  SELECT 1 FROM "role_permissions" existing
  WHERE existing."role_id" = r."id"
    AND existing."organization_id" = r."organization_id"
    AND existing."permission" = 'rbac.role.manage'
)
ON CONFLICT DO NOTHING;
