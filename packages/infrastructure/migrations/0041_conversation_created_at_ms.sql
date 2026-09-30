-- `CR.31`: milliseconds, like `messages.created_at`. `KeysetCursor` encodes milliseconds, so a
-- microsecond sort key skipped the rows inside the truncated window. Rewrites the table and
-- rebuilds `conversations_recent_idx`; conversations are one row per room, not per message.
ALTER TABLE "conversations" ALTER COLUMN "created_at" SET DATA TYPE timestamp (3) with time zone;--> statement-breakpoint
ALTER TABLE "conversations" ALTER COLUMN "created_at" SET DEFAULT now();