import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// The one env file, loaded here because a vitest config is a bin's argument rather than
// a `tsx` entrypoint and cannot be handed `--env-file-if-exists`. See `.env.example`.
const ENV_FILE = fileURLToPath(new URL("../../.env", import.meta.url));
if (existsSync(ENV_FILE)) process.loadEnvFile(ENV_FILE);

export default defineConfig({
  // Resolve workspace siblings to their `src/`, the same condition
  // `apps/web/vite.config.ts` sets. Without it a spec runs against a sibling's
  // stale `dist/` and a green suite proves nothing about the code you just edited.
  resolve: { conditions: ["development"] },
  test: {
    include: ["tests/**/*.spec.ts"],
    // `tests/smoke/` needs S3 and Loki as well as the two this suite
    // already assumes. `pnpm smoke` runs it, against a stack that is actually up.
    exclude: ["**/node_modules/**", "tests/smoke/**"],
    // One scratch database, and several specs here assert on state no tenant owns: the
    // outbox drain, the expiry sweep and the partition catalog are all untenanted.
    fileParallelism: false,
    // Drops the partitions of tenants a spec founded and deleted. Without it they
    // accumulate until a cascading delete runs out of locks. See the file's comment.
    globalSetup: ["tests/support/orphan-sweep.ts"],
    // Every case here is a round trip to Postgres or Redis, the same reason
    // `vitest.smoke.config.ts` raises it. The 5s default flakes under a full `pnpm test`.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
