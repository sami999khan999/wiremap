import { z } from "zod";

// The second and last `process.env` reader, and deliberately not sharing the web app's
// schema — see docs/reference/env.md.
const Schema = z.object({
  DATABASE_URL: z.url(),
  // The same server without the pooler. Migrations, the seed and the archive's DDL
  // use it — see docs/reference/env.md.
  DATABASE_DIRECT_URL: z.url().optional(),
  // Node 0's streaming standby — `24.3`. Reads move onto it only while
  // `platform_policy.replica_reads_enabled` is on, and only once it has caught up.
  DATABASE_REPLICA_URL: z.url().optional(),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).default(20),
  DATABASE_POOL_IDLE_TIMEOUT_MS: z.coerce.number().int().min(0).default(30_000),
  DATABASE_POOL_CONNECT_TIMEOUT_MS: z.coerce.number().int().min(1).default(5_000),
  // 120 s, against the web app's 30 s: a batch holds no browser open, and the outbox
  // relay inside `PgUnitOfWork.run` is the long transaction this exists for.
  DATABASE_STATEMENT_TIMEOUT_MS: z.coerce.number().int().min(1).default(120_000),
  REDIS_CACHE_URL: z.url(),
  REDIS_QUEUE_URL: z.url(),
  // Live frames; the cache instance when unset. See docs/infra/reference/redis.md.
  REDIS_REALTIME_URL: z.url().optional(),

  S3_ENDPOINT: z.url(),
  S3_REGION: z.string().min(1),
  S3_BUCKET: z.string().min(1),
  S3_ACCESS_KEY: z.string().min(1),
  S3_SECRET_KEY: z.string().min(1),
  // Defaulted like `LOG_PRETTY`, and to the production answer: real S3 wants virtual-host
  // addressing, MinIO wants path-style, and `.env.example` sets `true` for the local stack.
  S3_FORCE_PATH_STYLE: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),

  // In both processes because both build a `Container`, which treats mail as required
  // rather than optional.
  SMTP_URL: z.string().min(1),
  EMAIL_FROM: z.string().min(1),
  // Required here too, and this is the process that needs it: the worker renders the
  // invitation link, and it parses no auth configuration to borrow an origin from.
  APP_BASE_URL: z.url(),

  EMBEDDING_MODEL: z.string().min(1),
  EMBEDDING_DIMENSIONS: z.coerce.number().int().positive(),
  OPENAI_API_KEY: z.string().default(""),

  // Per process. The cap exists to stop one runaway tab, which is local by
  // construction, and the age is what releases a channel a leaked reader is holding.
  REALTIME_MAX_STREAMS_PER_USER: z.coerce.number().int().positive().default(8),
  REALTIME_STREAM_MAX_AGE_SECONDS: z.coerce.number().int().positive().default(1800),

  // Longer than your longest job, shorter than your orchestrator's SIGKILL timer: above
  // it just means the platform kills you mid-drain.
  WORKER_SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().positive().default(25_000),
  WORKER_EMBEDDING_CONCURRENCY: z.coerce.number().int().positive().default(4),
  // Serial by default: these jobs take table-level locks and can deadlock on the same
  // partition.
  WORKER_MAINTENANCE_CONCURRENCY: z.coerce.number().int().positive().default(1),
  WORKER_MAIL_CONCURRENCY: z.coerce.number().int().positive().default(4),
  WORKER_EVENT_CONCURRENCY: z.coerce.number().int().positive().default(8),
  // Two. The digest fan-out is one job a day and each tenant's digest is I/O bound
  // on the mail queue, which has its own limiter.
  WORKER_NOTIFICATION_CONCURRENCY: z.coerce.number().int().positive().default(2),
  // A provider's cap, expressed once. Ten a second is under every managed sender's
  // free tier and well under a self-hosted relay's.
  WORKER_MAIL_RATE_PER_MINUTE: z.coerce.number().int().positive().default(600),

  // The same block the web app parses: a worker with no log output cannot be operated.

  // ── the swappable stores ──
  // A driver plus the connection detail it needs, so adopting a store is these variables
  // and nothing else.
  VECTOR_DRIVER: z.enum(["pgvector"]).default("pgvector"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  LOG_PRETTY: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  // Two of the four log labels. Low-cardinality by construction, and this default is
  // why `.env` must not pin `APP` globally — both processes would claim one name.
  APP: z.string().default("worker"),
  ENV: z.string().default("development"),

  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
});

// `DATABASE_SHARD_<n>_URL` in index order, each with an optional `_DIRECT_URL` and
// `_REPLICA_URL` beside it. Absent is one node, which is every deployment until the split.
const shardsFromEnv = (): readonly { url: string; directUrl: string; replicaUrl?: string }[] => {
  const found: { index: number; url: string; directUrl: string; replicaUrl?: string }[] = [];

  for (const [name, value] of Object.entries(process.env)) {
    const match = /^DATABASE_SHARD_(\d+)_URL$/.exec(name);
    if (!match?.[1] || !value) continue;

    const index = Number(match[1]);
    // Node 0 is `DATABASE_URL`; a `DATABASE_SHARD_0_URL` beside it would be two names
    // for one pool and a disagreement about which is the catalog.
    if (index < 1) continue;

    found.push({
      index,
      url: value,
      directUrl: process.env[`DATABASE_SHARD_${index}_DIRECT_URL`] ?? value,
      // `||`, not `??`: an empty value is "no standby", the way `.env.example` shows one.
      replicaUrl: process.env[`DATABASE_SHARD_${index}_REPLICA_URL`] || undefined,
    });
  }

  // Contiguity-checked: the cluster indexes this array, so a gap puts node 3 at
  // index 2 and resolves every tenant on it to the wrong database.
  const sorted = found.toSorted((left, right) => left.index - right.index);
  sorted.forEach((shard, at) => {
    if (shard.index !== at + 1) {
      throw new Error(`DATABASE_SHARD_${shard.index}_URL has no shard ${at + 1} before it.`);
    }
  });

  return sorted.map(({ url, directUrl, replicaUrl }) => ({ url, directUrl, replicaUrl }));
};

export class Env {
  private constructor() {}

  // Parsed at module load, not on first access. A missing `DATABASE_URL` should crash
  // the process at boot with a field path, not fail the first job an hour later.
  private static readonly parsed = Schema.parse(process.env);

  public static get isProduction(): boolean {
    return Env.parsed.NODE_ENV === "production";
  }

  public static get shutdownTimeoutMs(): number {
    return Env.parsed.WORKER_SHUTDOWN_TIMEOUT_MS;
  }

  // Per worker instance, never global. Four instances at concurrency 4 is sixteen
  // in-flight jobs, each of which may hold a Postgres connection.
  public static get embeddingConcurrency(): number {
    return Env.parsed.WORKER_EMBEDDING_CONCURRENCY;
  }

  public static get maintenanceConcurrency(): number {
    return Env.parsed.WORKER_MAINTENANCE_CONCURRENCY;
  }

  public static get mailConcurrency(): number {
    return Env.parsed.WORKER_MAIL_CONCURRENCY;
  }

  public static get mailRatePerMinute(): number {
    return Env.parsed.WORKER_MAIL_RATE_PER_MINUTE;
  }

  public static get eventConcurrency(): number {
    return Env.parsed.WORKER_EVENT_CONCURRENCY;
  }

  public static get notificationConcurrency(): number {
    return Env.parsed.WORKER_NOTIFICATION_CONCURRENCY;
  }

  // Read by `WorkerBootstrap` to compare against what it is about to run concurrently.
  // The pool itself is built from `containerConfig()`; this is the same number.
  public static get databasePoolMax(): number {
    return Env.parsed.DATABASE_POOL_MAX;
  }

  // Where environment becomes `ContainerConfig`. No `auth` block, so this process holds
  // no session secret.
  public static containerConfig() {
    const e = Env.parsed;
    return {
      database: {
        url: e.DATABASE_URL,
        directUrl: e.DATABASE_DIRECT_URL ?? e.DATABASE_URL,
        replicaUrl: e.DATABASE_REPLICA_URL,
        poolMax: e.DATABASE_POOL_MAX,
        poolIdleTimeoutMs: e.DATABASE_POOL_IDLE_TIMEOUT_MS,
        poolConnectTimeoutMs: e.DATABASE_POOL_CONNECT_TIMEOUT_MS,
        statementTimeoutMs: e.DATABASE_STATEMENT_TIMEOUT_MS,
        shards: shardsFromEnv(),
      },
      redis: {
        cacheUrl: e.REDIS_CACHE_URL,
        queueUrl: e.REDIS_QUEUE_URL,
        ...(e.REDIS_REALTIME_URL ? { realtimeUrl: e.REDIS_REALTIME_URL } : {}),
      },
      storage: {
        endpoint: e.S3_ENDPOINT,
        region: e.S3_REGION,
        bucket: e.S3_BUCKET,
        accessKey: e.S3_ACCESS_KEY,
        secretKey: e.S3_SECRET_KEY,
        forcePathStyle: e.S3_FORCE_PATH_STYLE,
      },
      email: { url: e.SMTP_URL, from: e.EMAIL_FROM, baseUrl: e.APP_BASE_URL },
      embedding: {
        apiKey: e.OPENAI_API_KEY,
        model: e.EMBEDDING_MODEL,
        dimensions: e.EMBEDDING_DIMENSIONS,
      },
      realtime: {
        maxStreamsPerUser: e.REALTIME_MAX_STREAMS_PER_USER,
        streamMaxAgeSeconds: e.REALTIME_STREAM_MAX_AGE_SECONDS,
      },
      vector: { driver: e.VECTOR_DRIVER },
      logging: { level: e.LOG_LEVEL, pretty: e.LOG_PRETTY, app: e.APP, env: e.ENV },
    } as const;
  }
}
