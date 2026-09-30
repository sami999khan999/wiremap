-- `24.2`: moving a tenant from one node to another, and the state that makes it safe.
--
-- `moving_to` is set while the copy runs and cleared when it lands. Non-null is what
-- the write freeze reads: during a move the tenant may be read on `node` and written
-- nowhere, so nothing can be accepted onto a copy that is about to be discarded.
--
-- `moved_from` and `source_droppable_at` are the way back. The flip is instant; the old
-- rows stay for a grace period so a bad move is undone by flipping the pointer, not by
-- a restore. The sweep reads `source_droppable_at` and nothing else, for the reason
-- `partition_archive.deleted_at` exists -- keyed on the move, not on the row's age.
--
-- `platform_policy.move_grace_days` is nullable on purpose. **Null is not zero**: it
-- means "use the deployment default", the way an absent `retention_policy` row does.
-- The operator sets it from the platform screen; unset falls back to the environment.
--
-- Every column is nullable and every add is safe on a table that already holds rows.
ALTER TABLE "platform_policy" ADD COLUMN "move_grace_days" smallint;--> statement-breakpoint
ALTER TABLE "shard_assignments" ADD COLUMN "moving_to" smallint;--> statement-breakpoint
ALTER TABLE "shard_assignments" ADD COLUMN "source_droppable_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "shard_assignments" ADD COLUMN "moved_from" smallint;--> statement-breakpoint
CREATE INDEX "shard_assignments_droppable_idx" ON "shard_assignments" USING btree ("source_droppable_at") WHERE source_droppable_at is not null;
