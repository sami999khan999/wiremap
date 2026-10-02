import { defineConfig } from "vitest/config";

// `Env` parses the whole worker schema at module load, so anything importing it —
// `WorkerBootstrap` reads `Env.shutdownTimeoutMs` — throws on import unless the
// environment is already complete. It has to be set here rather than in a setup file:
// `noProcessEnv` is on everywhere except the config files and the enumerated scripts,
// and a `vitest.setup.ts` writing `process.env` would need a new exemption in two
// places (see doc 26). Values are the *shape* of a real environment, never a real one.
const ENV = {
  DATABASE_URL: "postgres://test:test@localhost:45432/test",
  REDIS_CACHE_URL: "redis://localhost:46379",
  REDIS_QUEUE_URL: "redis://localhost:46379",

  S3_ENDPOINT: "http://localhost:49000",
  S3_REGION: "us-east-1",
  S3_BUCKET: "test",
  S3_ACCESS_KEY: "test",
  S3_SECRET_KEY: "testsecret",
  S3_FORCE_PATH_STYLE: "true",

  SMTP_URL: "smtp://localhost:41025",
  EMAIL_FROM: "Test <no-reply@localhost>",
  APP_BASE_URL: "http://localhost:43000",

  EMBEDDING_MODEL: "text-embedding-3-small",
  EMBEDDING_DIMENSIONS: "1536",

  // Short enough that a spec can let the backstop win without waiting on the 25s
  // production default.
  WORKER_SHUTDOWN_TIMEOUT_MS: "20",
};

export default defineConfig({
  // Resolve workspace siblings to their `src/`, not a stale `dist/`.
  resolve: { conditions: ["development"] },
  test: { include: ["tests/**/*.spec.ts"], env: ENV },
});
