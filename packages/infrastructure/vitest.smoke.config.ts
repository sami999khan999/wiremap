import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// The repository root, not this package: a pnpm filter runs with the package as cwd. A
// vitest config is a bin's argument rather than a `tsx` entrypoint, so it loads its own.
const ENV_FILE = fileURLToPath(new URL("../../.env", import.meta.url));
if (existsSync(ENV_FILE)) process.loadEnvFile(ENV_FILE);

const required = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required to run the smoke suite.`);
  return value;
};

const optional = (name: string): string | undefined => process.env[name] || undefined;

// A comma-separated list of tenant counts, read here for the reason every other value is:
// `noProcessEnv` and assertion 3 both walk `tests/`.
const numbers = (name: string): number[] | undefined =>
  optional(name)
    ?.split(",")
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isInteger(value) && value > 0);

const tenantCeiling = numbers("TENANT_CEILING");
const fanOut = numbers("FAN_OUT_SCALE");
const routed = numbers("ROUTED_SCALE");

const shard1Url = optional("DATABASE_SHARD_1_URL");
const replicaUrl = optional("DATABASE_REPLICA_URL");
const coldClass = optional("S3_COLD_STORAGE_CLASS");
const coldDays = numbers("S3_COLD_TRANSITION_DAYS")?.[0];
const lokiUrl = optional("LOKI_URL");

export default defineConfig({
  resolve: { conditions: ["development"] },
  test: {
    include: ["tests/smoke/**/*.smoke.spec.ts"],
    // Serially: two files racing on the same bucket and the same queue key is a flake
    // that only reproduces on a fast machine.
    fileParallelism: false,
    // The same sweep `vitest.config.ts` runs, and for the same reason: two files here
    // found tenants, and a run killed half way through leaves their partitions behind.
    globalSetup: ["tests/support/orphan-sweep.ts"],
    // Real round trips to five services, and MinIO's first request pays for the pool.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // The whole environment read, once, here — see `tests/smoke/support/stack.ts`.
    provide: {
      stack: {
        database: {
          url: required("DATABASE_URL"),
          // Falls back rather than being required: a deployment running no pooler has
          // one URL, and the pooler-sensitive cases still mean something against it.
          directUrl: optional("DATABASE_DIRECT_URL") ?? required("DATABASE_URL"),
        },
        ...(shard1Url
          ? {
              shard1: {
                url: shard1Url,
                directUrl: optional("DATABASE_SHARD_1_DIRECT_URL") ?? shard1Url,
              },
            }
          : {}),
        ...(replicaUrl ? { replica: { url: replicaUrl } } : {}),
        redis: {
          cacheUrl: required("REDIS_CACHE_URL"),
          queueUrl: required("REDIS_QUEUE_URL"),
        },
        storage: {
          endpoint: required("S3_ENDPOINT"),
          region: required("S3_REGION"),
          bucket: required("S3_BUCKET"),
          accessKey: required("S3_ACCESS_KEY"),
          secretKey: required("S3_SECRET_KEY"),
          forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
        },
        ...(coldClass && coldDays
          ? { coldTier: { storageClass: coldClass, afterDays: coldDays } }
          : {}),
        ...(tenantCeiling?.length ? { tenantCeiling } : {}),
        ...(fanOut?.length ? { fanOut } : {}),
        ...(routed?.length ? { routed } : {}),
        ...(lokiUrl ? { loki: { url: lokiUrl, tenantId: optional("LOKI_TENANT_ID") } } : {}),
      },
    },
  },
});
