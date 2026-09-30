-- Redundant since 0005 made `role_permissions_uq` lead with `organization_id`: a btree
-- index serves any leading-column prefix, so this one only cost write throughput.
DROP INDEX "role_permissions_organization_idx";--> statement-breakpoint

-- The projection's keyset. `since()` walks `(occurred_at, id)` across every tenant, so
-- without this each batch scans every partition of `activity_log`.
CREATE INDEX "activity_log_replay_idx" ON "activity_log" USING btree ("occurred_at","id");
