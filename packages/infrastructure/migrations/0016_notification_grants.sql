-- Hand-written: drizzle-kit writes DDL, and this is data. The seed grants permissions to
-- *system* roles on tenants created from here on; this backfills the ones that already
-- exist, including any custom role a customer built from `admin` or `member`.
--
-- It is also the release switch. Until this runs, `notification.inbox.read` is held by
-- nobody, the nav entry is hidden for everyone and every procedure returns FORBIDDEN.

INSERT INTO "role_permissions" ("organization_id", "role_id", "permission")
SELECT r."organization_id", r."id", k."permission"
FROM "roles" r
CROSS JOIN (VALUES
  ('notification.inbox.read'),
  ('notification.inbox.update'),
  ('notification.preference.update')
) AS k("permission")
-- Every role that can already see the member list, by the rows it holds rather than by
-- its key. That is `owner` (seeded with every permission, resolved at seed time),
-- `admin`, `member`, and any custom role a customer built from one of them. It is not
-- `guest`, which holds nothing — a guest has no membership to be notified about.
WHERE EXISTS (
  SELECT 1 FROM "role_permissions" existing
  WHERE existing."role_id" = r."id"
    AND existing."organization_id" = r."organization_id"
    AND existing."permission" = 'member.read'
)
ON CONFLICT DO NOTHING;
