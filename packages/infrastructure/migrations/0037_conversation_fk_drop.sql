-- `PF.1`: the two keys between siblings on a shard, `messages` and `conversation_members`
-- into `conversations`.
--
-- They cost every signup. A key referencing a partitioned table is validated on every
-- `ATTACH PARTITION` of the referencing table, and that validation takes
-- SHARE ROW EXCLUSIVE on `conversations` -- measured at 12-31 ms per attach against 4-7 ms
-- for a table with no key, five times per new tenant, blocking every conversation insert
-- on the node while it runs.
--
-- They checked nothing the code does not. Every insert into either table runs
-- `ConversationAccess.assertMember` first, and nothing deletes a conversation, so
-- NO ACTION never fired. The nightly `orphans` job counts rows whose conversation is
-- missing, as it counts tenants since `24.1`.
--
-- Their indexes stay: `messages_keyset_idx` and the member reads are what use them.
-- One statement per breakpoint, for the lock reason `0035` gives.
ALTER TABLE "conversation_members" DROP CONSTRAINT "conversation_members_conversation_fk";
--> statement-breakpoint
ALTER TABLE "messages" DROP CONSTRAINT "messages_conversation_fk";
