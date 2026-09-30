-- A JS `Date` holds milliseconds and `now()` writes microseconds, so a `created_at`
-- read back through the client and sent again matched no row at all.
--
-- That is not cosmetic: `findById`, `edit` and `softDelete` all carry this value as a
-- predicate, and `unreadCounts` compares it to `last_read_at`, which is written from the
-- application clock. Editing a message did nothing, deleting it did nothing, and a
-- conversation the reader had just read still showed one unread.
--
-- Rounds the values already stored, which is safe: no row is a millisecond old, and the
-- rounding is what makes every one of them reachable again.
ALTER TABLE "messages" ALTER COLUMN "created_at" SET DATA TYPE timestamp (3) with time zone;--> statement-breakpoint
ALTER TABLE "messages" ALTER COLUMN "created_at" SET DEFAULT now();