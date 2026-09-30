-- Hand-written: drizzle-kit asks interactively whether this is a rename, and a new column
-- beside the old would split one fact in two. `users.deactivated_at` was declared and never
-- read; it becomes the platform's account suspend. The snapshot is renamed to match.
ALTER TABLE "users" RENAME COLUMN "deactivated_at" TO "suspended_at";
