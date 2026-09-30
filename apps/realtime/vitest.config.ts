import { defineConfig } from "vitest/config";

// `Env` parses the whole schema at module load, so anything importing it throws unless the
// environment is complete. Set here for the reason `apps/worker/vitest.config.ts` gives.
const ENV = {
  DATABASE_URL: "postgres://test:test@localhost:25432/test",
  REDIS_CACHE_URL: "redis://localhost:26379",
  REDIS_QUEUE_URL: "redis://localhost:26380",

  S3_ENDPOINT: "http://localhost:29000",
  S3_REGION: "us-east-1",
  S3_BUCKET: "test",
  S3_ACCESS_KEY: "test",
  S3_SECRET_KEY: "testsecret",

  AUTH_SECRET: "a-test-secret-that-is-at-least-thirty-two-chars",
  AUTH_URL: "http://localhost:23000",
  AUTH_TRUSTED_ORIGINS: "http://localhost:23000",
  AUTH_SESSION_MAX_AGE_SECONDS: "604800",
  AUTH_COOKIE_CACHE_MAX_AGE_SECONDS: "60",

  SMTP_URL: "smtp://localhost:21025",
  EMAIL_FROM: "Test <no-reply@localhost>",
  APP_BASE_URL: "http://localhost:23000",

  EMBEDDING_MODEL: "text-embedding-3-small",
  EMBEDDING_DIMENSIONS: "1536",

  REALTIME_SHUTDOWN_TIMEOUT_MS: "50",
};

export default defineConfig({
  // Resolve workspace siblings to their `src/`, not a stale `dist/`.
  resolve: { conditions: ["development"] },
  test: { include: ["tests/**/*.spec.ts"], env: ENV },
});
