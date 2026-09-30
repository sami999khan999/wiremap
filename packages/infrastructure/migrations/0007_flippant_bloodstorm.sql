-- Hand-edited after `drizzle-kit generate`: the delete below is what lets 0008 add a
-- NOT NULL column, and it is also the migration itself.
--
-- Every pending invitation is discarded rather than migrated. The column held the
-- plaintext token and the replacement holds its digest, so there is nothing to carry
-- across — a hash cannot be computed from a value the new column is not allowed to see,
-- and re-hashing the old plaintext would be storing what this change exists to stop
-- storing. Invitations live seven days; the operator action is "invite them again".
DELETE FROM "invitations";--> statement-breakpoint

DROP INDEX "invitations_token_uq";--> statement-breakpoint
ALTER TABLE "invitations" DROP COLUMN "token";
