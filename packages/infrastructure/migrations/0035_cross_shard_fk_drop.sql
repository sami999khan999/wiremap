-- Decision `24.1`: the ten keys that pointed from a shard back to the catalog.
--
-- Postgres enforces no foreign key across two databases, so every one of these stops
-- being possible the day a shard is a separate server. Keeping them is not a safer
-- choice; it is the choice to abandon the split.
--
-- Nine were already doing nothing. `DeleteOrganizationUseCase` calls
-- `dropTenantPartitions` *before* it deletes the `organizations` row, so by the time
-- these would fire the tenant's rows are gone with their partitions. The three naming
-- `users` never fired at all: nothing in `src/` deletes a user.
--
-- `outbox_event` is the exception and the only real change. It has no tenant level, so
-- partition-dropping never reached it and this cascade was its only reaper. The
-- use-case now deletes those rows itself.
--
-- What is given up: Postgres no longer guarantees there are no orphans. The nightly
-- `orphans` job counts them per node instead -- a guarantee moved, not dropped.
--
-- One statement per breakpoint on purpose. Each takes ACCESS EXCLUSIVE on the parent
-- *and* every partition under it, and ten in one transaction is a lock storm.
ALTER TABLE "conversation_members" DROP CONSTRAINT "conversation_members_organization_id_organizations_id_fk";
--> statement-breakpoint
ALTER TABLE "conversation_members" DROP CONSTRAINT "conversation_members_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "conversations" DROP CONSTRAINT "conversations_organization_id_organizations_id_fk";
--> statement-breakpoint
ALTER TABLE "messages" DROP CONSTRAINT "messages_organization_id_organizations_id_fk";
--> statement-breakpoint
ALTER TABLE "notification_preferences" DROP CONSTRAINT "notification_preferences_organization_id_organizations_id_fk";
--> statement-breakpoint
ALTER TABLE "notification_preferences" DROP CONSTRAINT "notification_preferences_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "notifications" DROP CONSTRAINT "notifications_organization_id_organizations_id_fk";
--> statement-breakpoint
ALTER TABLE "notifications" DROP CONSTRAINT "notifications_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "outbox_event" DROP CONSTRAINT "outbox_event_organization_id_organizations_id_fk";
--> statement-breakpoint
ALTER TABLE "document_chunks" DROP CONSTRAINT "document_chunks_organization_id_organizations_id_fk";
