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
  test: { include: ["tests/**/*.spec.ts"] },
});
