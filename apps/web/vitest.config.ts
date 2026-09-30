import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// `Env` parses the whole server schema at module load, so anything importing it — `Cors`
// reads `Env.trustedOrigins` — throws on import unless the environment is already
// complete. It has to be set here rather than in a setup file: `noProcessEnv` is on
// everywhere except the config files and the enumerated scripts, and a `vitest.setup.ts`
// writing `process.env` would need a new exemption in two places (see doc 26).
//
// Values are the *shape* of a real environment, never a real one. Nothing here connects.
const ENV = {
  DATABASE_URL: "postgres://test:test@localhost:25432/test",
  REDIS_CACHE_URL: "redis://localhost:26379",
  REDIS_QUEUE_URL: "redis://localhost:26380",

  S3_ENDPOINT: "http://localhost:29000",
  S3_REGION: "us-east-1",
  S3_BUCKET: "test",
  S3_ACCESS_KEY: "test",
  S3_SECRET_KEY: "testsecret",
  S3_FORCE_PATH_STYLE: "true",

  SMTP_URL: "smtp://localhost:21025",
  EMAIL_FROM: "Test <no-reply@localhost>",
  APP_BASE_URL: "http://localhost:23000",

  AUTH_SECRET: "test-secret-test-secret-test-secret-32",
  AUTH_URL: "http://localhost:23000",
  // Two entries, so a spec can tell "on the allowlist" from "the allowlist has one
  // thing in it".
  AUTH_TRUSTED_ORIGINS: "http://localhost:23000,tauri://localhost",
  AUTH_SESSION_MAX_AGE_SECONDS: "604800",
  AUTH_COOKIE_CACHE_MAX_AGE_SECONDS: "60",

  EMBEDDING_MODEL: "text-embedding-3-small",
  EMBEDDING_DIMENSIONS: "1536",
};

// Separate from `vite.config.ts` on purpose, and the reason is cost rather than taste.
// Without this file Vitest falls back to `vite.config.ts`, which loads the TanStack
// Start plugin and Nitro for every run — route generation and a dev server that has
// nothing to do with a unit test. The server also never shuts down cleanly, so the run
// ends with `close timed out after 10000ms` and "something prevents Vite server from
// exiting": ~30s wall and a warning everyone learns to ignore, on a suite of pure
// functions.
//
// Nothing under `tests/` needs the plugins. A spec that genuinely needs a rendered
// route belongs in an end-to-end runner, not here.
export default defineConfig({
  resolve: {
    // Resolve workspace siblings to their `src/`, the same condition `vite.config.ts`
    // sets for `vite dev`. Without it a spec runs against a sibling's stale `dist/`.
    conditions: ["development"],
    // `~/*` is a tsconfig path, and tsconfig paths are a type-checker feature. The Start
    // plugin teaches Vite about it during a real build; without that plugin, a spec
    // reaching anything that imports `~/env.js` fails to resolve it.
    alias: { "~": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    include: ["tests/**/*.spec.ts", "tests/**/*.spec.tsx"],
    // The smoke suite needs a built server, a worker and live containers, and has
    // its own config. Without this `pnpm test` collects it and hangs on a boot.
    exclude: ["tests/smoke/**"],
    globals: false,
    env: ENV,
  },
});
