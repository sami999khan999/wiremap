-- `CP4.2`: the drain's lease. The claim commits on its own and stamps this, so the relay to
-- the queue runs with no transaction open; a drain that dies mid-relay frees its rows when
-- the lease passes. Nullable, so adding it rewrites nothing.
ALTER TABLE "outbox_event" ADD COLUMN "claimed_until" timestamp with time zone;