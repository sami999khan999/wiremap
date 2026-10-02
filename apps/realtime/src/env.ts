import { z } from "zod";

// The stream process's `process.env` reader. It resolves principals, so it carries the auth
// block the worker does not — and it must match the web app's. See docs/reference/env.md.
const Schema = z
  .object({
    DATABASE_URL: z.url(),
    // The same server without the pooler. Defaults to `DATABASE_URL`, which is correct
    // only while nothing is pooling — see docs/reference/env.md.
    DATABASE_DIRECT_URL: z.url().optional(),
    // Node 0's streaming standby — `24.3`. Reads move onto it only while
    // `platform_policy.replica_reads_enabled` is on, and only once it has caught up.
    DATABASE_REPLICA_URL: z.url().optional(),
    // Five, not twenty: never a query per frame, but one per open stream each minute to
    // revalidate it — about 170 a second at 10 000 streams. See docs/reference/env.md.
    DATABASE_POOL_MAX: z.coerce.number().int().min(1).default(5),
    DATABASE_POOL_IDLE_TIMEOUT_MS: z.coerce.number().int().min(0).default(30_000),
    // Today an unreachable Postgres hangs the request for the OS default, which is
    // longer than every timeout in front of it.
    DATABASE_POOL_CONNECT_TIMEOUT_MS: z.coerce.number().int().min(1).default(5_000),
    // 30 s here and 120 s in the worker: a request nobody is waiting on may take longer
    // than one a browser is. The only field whose default differs between the two apps.
    DATABASE_STATEMENT_TIMEOUT_MS: z.coerce.number().int().min(1).default(30_000),
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

    // A short secret is a real weakness, and this schema is the only place anyone will
    // ever check.
    AUTH_SECRET: z.string().min(32),
    AUTH_URL: z.url(),
    AUTH_TRUSTED_ORIGINS: z.string().transform((v) => v.split(",").map((s) => s.trim())),
    AUTH_SESSION_MAX_AGE_SECONDS: z.coerce.number().int().positive(),
    // The revocation window, capped in the schema rather than by convention: a deploy
    // that raises it fails at boot instead of widening the gap silently.
    AUTH_COOKIE_CACHE_MAX_AGE_SECONDS: z.coerce.number().int().positive().max(60),
    AUTH_REQUIRE_EMAIL_VERIFICATION: z
      .enum(["true", "false"])
      .default("true")
      .transform((v) => v === "true"),
    // What an authenticator app shows beside a TOTP code. Changing it after anyone has
    // enrolled leaves their authenticator naming a product that no longer exists.
    AUTH_APP_NAME: z.string().min(1).default("Loadbearing"),
    // How a new user acquires the membership without which no session is issued.
    // `personal` is the only mode that works against an empty database.
    AUTH_ENROLMENT_MODE: z.enum(["personal", "bootstrap", "invite"]).default("personal"),
    // A ceiling on the total, which the 5/min rate limit on `/organization/create` does
    // not give: each tenant seeds four roles and every permission the registry defines.
    AUTH_MAX_OWNED_ORGANIZATIONS: z.coerce.number().int().positive().default(10),
    // The same slug `pnpm db:seed` creates. Unset means no enrolment at all, which is
    // the production posture and why there is no default.
    BOOTSTRAP_ORGANIZATION_SLUG: z.string().min(1).optional(),

    // Both optional: the container builds a provider only when both are present. The
    // authorised redirect URI is `${AUTH_URL}/api/auth/callback/google`.
    GOOGLE_CLIENT_ID: z.string().min(1).optional(),
    GOOGLE_CLIENT_SECRET: z.string().min(1).optional(),

    // One URL rather than five fields, and required: with verification on by default, a
    // process that cannot send is one whose sign-ups never complete.
    SMTP_URL: z.string().min(1),
    // Never defaulted: an address the sending domain does not authorise bounces or lands
    // in spam, silently.
    EMAIL_FROM: z.string().min(1),
    // The origin a link in a message points at. Separate from `AUTH_URL`, which is Better
    // Auth's own: the worker sends invitation mail and parses no auth configuration.
    APP_BASE_URL: z.url(),

    // `none` searches the chunk text and calls nobody. `openai` and `gemini` embed, need
    // the key below, and default the model when unset. See infrastructure's embedding.md.
    EMBEDDING_PROVIDER: z.enum(["none", "openai", "gemini"]).default("none"),
    EMBEDDING_API_KEY: z.string().min(1).optional(),
    EMBEDDING_MODEL: z.string().min(1).optional(),
    EMBEDDING_DIMENSIONS: z.coerce.number().int().positive().default(1536),

    // Per process. The cap exists to stop one runaway tab, which is local by
    // construction, and the age is what releases a channel a leaked reader is holding.
    REALTIME_MAX_STREAMS_PER_USER: z.coerce.number().int().positive().default(8),
    REALTIME_STREAM_MAX_AGE_SECONDS: z.coerce.number().int().positive().default(1800),
    // Where the browser's `/api/realtime` is proxied to. The web app's Vite reads it too.
    REALTIME_PORT: z.coerce.number().int().min(1).max(65_535).default(43001),
    // How long a stop may take to hand every open stream on before the rest are cut.
    REALTIME_SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().positive().default(20_000),

    // ── the swappable stores ──
    // A driver plus the connection detail it needs, so adopting a store is these
    // variables and nothing else.
    VECTOR_DRIVER: z.enum(["pgvector"]).default("pgvector"),
    LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
    LOG_PRETTY: z
      .enum(["true", "false"])
      .default("false")
      .transform((v) => v === "true"),
    // Two of the four log labels. Low-cardinality by construction.
    APP: z.string().default("realtime"),
    ENV: z.string().default("development"),

    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  })
  // Two cross-field rules, and each earns the exception: `bootstrap` with no slug enrols
  // nobody, and an embedding provider with no key fails on the first document.
  .superRefine((env, ctx) => {
    // A provider with no key would fail on the first document, long after the deploy.
    if (env.EMBEDDING_PROVIDER !== "none" && !env.EMBEDDING_API_KEY) {
      ctx.addIssue({
        code: "custom",
        path: ["EMBEDDING_API_KEY"],
        message: `Required when EMBEDDING_PROVIDER is "${env.EMBEDDING_PROVIDER}".`,
      });
    }

    if (env.AUTH_ENROLMENT_MODE === "bootstrap" && !env.BOOTSTRAP_ORGANIZATION_SLUG) {
      ctx.addIssue({
        code: "custom",
        path: ["BOOTSTRAP_ORGANIZATION_SLUG"],
        message: 'Required when AUTH_ENROLMENT_MODE is "bootstrap".',
      });
    }
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

  // At module load, not on first access: a missing `AUTH_SECRET` should crash at boot
  // with a field path, not 500 on the first sign-in an hour later.
  private static readonly parsed = Schema.parse(process.env);

  public static get isProduction(): boolean {
    return Env.parsed.NODE_ENV === "production";
  }

  public static get port(): number {
    return Env.parsed.REALTIME_PORT;
  }

  public static get shutdownTimeoutMs(): number {
    return Env.parsed.REALTIME_SHUTDOWN_TIMEOUT_MS;
  }

  // The one origin allowlist, read by Better Auth's CSRF check and by the CORS layer.
  // A second hardcoded copy is how one of them goes stale.
  public static get trustedOrigins(): readonly string[] {
    return Env.parsed.AUTH_TRUSTED_ORIGINS;
  }

  // The boundary where environment becomes `ContainerConfig` (17).
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
      auth: {
        secret: e.AUTH_SECRET,
        baseUrl: e.AUTH_URL,
        trustedOrigins: e.AUTH_TRUSTED_ORIGINS,
        sessionMaxAgeSeconds: e.AUTH_SESSION_MAX_AGE_SECONDS,
        cookieCacheMaxAgeSeconds: e.AUTH_COOKIE_CACHE_MAX_AGE_SECONDS,
        requireEmailVerification: e.AUTH_REQUIRE_EMAIL_VERIFICATION,
        appName: e.AUTH_APP_NAME,
        enrolmentMode: e.AUTH_ENROLMENT_MODE,
        bootstrapOrganizationSlug: e.BOOTSTRAP_ORGANIZATION_SLUG,
        maxOwnedOrganizations: e.AUTH_MAX_OWNED_ORGANIZATIONS,
        // Both halves or neither: a partly-filled pair builds a provider pointed at a
        // client Google rejects.
        google:
          e.GOOGLE_CLIENT_ID && e.GOOGLE_CLIENT_SECRET
            ? { clientId: e.GOOGLE_CLIENT_ID, clientSecret: e.GOOGLE_CLIENT_SECRET }
            : undefined,
      },
      email: { url: e.SMTP_URL, from: e.EMAIL_FROM, baseUrl: e.APP_BASE_URL },
      embedding: {
        provider: e.EMBEDDING_PROVIDER,
        dimensions: e.EMBEDDING_DIMENSIONS,
        ...(e.EMBEDDING_API_KEY ? { apiKey: e.EMBEDDING_API_KEY } : {}),
        ...(e.EMBEDDING_MODEL ? { model: e.EMBEDDING_MODEL } : {}),
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
