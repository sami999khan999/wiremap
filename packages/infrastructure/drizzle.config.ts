import { existsSync } from "node:fs";
import { defineConfig } from "drizzle-kit";

// drizzle-kit is a bin rather than a `tsx` entrypoint, so the `--env-file-if-exists` every
// other `db:*` script carries cannot be handed to it. Without this, `pnpm db:generate`
// throws below on a machine whose `.env` holds both URLs.
//
// The same `../../.env` the sibling scripts pass, from the package directory a pnpm filter
// runs in. It never overwrites a variable already set, so CI's job env still wins.
const ENV_FILE = "../../.env";
if (existsSync(ENV_FILE)) process.loadEnvFile(ENV_FILE);

// A build-time tool config, not package runtime code — the one category allowed to
// read the environment directly. An explicit throw, not `!`: an undefined URL here
// produces a connection error naming nothing.
//
// Direct, never pooled: drizzle-kit introspects and writes DDL, and `db:studio` holds a
// session open. `DATABASE_URL` is the fallback for a deployment running no pooler.
//
// The **catalog**, never a shard, and it does not loop: every node runs the same schema,
// so generating against one and applying to all is what `migrate.ts` is for.
const url = process.env.DATABASE_DIRECT_URL ?? process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_DIRECT_URL or DATABASE_URL is required.");

export default defineConfig({
  schema: "./src/pg/schema/index.ts",
  out: "./migrations",
  dialect: "postgresql",
  dbCredentials: { url },
  strict: true,
  verbose: true,
});
