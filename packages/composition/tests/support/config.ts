import type { ContainerConfig } from "../../src/container/container.config.js";

// This suite's `env.ts`, the role `infrastructure`'s harness plays for its own: the one
// place it reads the environment, named in §3 and in Biome's overrides.
// ──
// `Container.health()` dials all three, so a literal here hangs on whatever holds the
// old port. The fallback is what a checkout with no `.env` gets.
const REDIS_CACHE_URL = process.env.REDIS_CACHE_URL ?? "redis://localhost:46379";
const REDIS_QUEUE_URL = process.env.REDIS_QUEUE_URL ?? "redis://localhost:46379";

export const DATABASE_URL =
  process.env.DATABASE_DIRECT_URL ??
  process.env.DATABASE_URL ??
  "postgres://ratchet:ratchet@localhost:45432/ratchet";

// Everything a container needs and nothing a deployment would decide. `auth` is absent,
// which is the shape the throwing getters are about.
export const baseConfig = (): ContainerConfig => ({
  database: { url: DATABASE_URL },
  redis: { cacheUrl: REDIS_CACHE_URL, queueUrl: REDIS_QUEUE_URL },
  storage: {
    endpoint: process.env.S3_ENDPOINT ?? "http://localhost:49000",
    region: "us-east-1",
    bucket: "loadbearing",
    accessKey: "ratchet",
    secretKey: "ratchetsecret",
    forcePathStyle: true,
  },
  email: {
    url: process.env.SMTP_URL ?? "smtp://localhost:41025",
    from: "noreply@example.test",
    baseUrl: "http://localhost:43000",
  },
  embedding: { provider: "none", dimensions: 1536 },
  realtime: { maxStreamsPerUser: 8, streamMaxAgeSeconds: 1800 },
  vector: { driver: "pgvector" },
  logging: { level: "error", pretty: false, app: "spec", env: "test" },
});

export const authConfig = (
  enrolmentMode: "personal" | "bootstrap" | "invite",
): NonNullable<ContainerConfig["auth"]> => ({
  secret: "spec-secret-spec-secret-spec-secret",
  baseUrl: "http://localhost:43000",
  trustedOrigins: ["http://localhost:43000"],
  sessionMaxAgeSeconds: 604_800,
  cookieCacheMaxAgeSeconds: 60,
  requireEmailVerification: true,
  appName: "Loadbearing",
  enrolmentMode,
  bootstrapOrganizationSlug: "loadbearing",
  maxOwnedOrganizations: 3,
});
