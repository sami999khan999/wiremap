import type { LogLevel } from "../import.js";

// Every value the system needs, in one shape, and none of it read from the environment:
// the two `env.ts` files parse it, validate it, and hand this object down.
export interface ContainerConfig {
  readonly database: {
    // Pooled. `directUrl` is the same server without the pooler, and it is what DDL that
    // cannot survive a transaction pooler uses — migrations, the seed, the archive.
    readonly url: string;
    readonly directUrl?: string;
    // Node 0's streaming standby, from `DATABASE_REPLICA_URL`. Absent is every read on
    // the primary; present, it is used only while `platform_policy` allows it — `24.3`.
    readonly replicaUrl?: string;
    // All optional, and the defaults are stated once, in `Database`. A second copy here
    // is the one that drifts from the pool that actually reads them.
    readonly poolMax?: number;
    readonly poolIdleTimeoutMs?: number;
    readonly poolConnectTimeoutMs?: number;
    // Nodes 1 and up, from `DATABASE_SHARD_<n>_URL`, in index order; absent is one
    // node. See packages/infrastructure/docs/reference/sharding.md.
    readonly shards?: readonly {
      readonly url: string;
      readonly directUrl: string;
      readonly replicaUrl?: string;
    }[];
    readonly statementTimeoutMs?: number;
  };
  readonly redis: {
    // Two instances, different durability. Neither is optional: a missing
    // queueUrl silently puts jobs on the instance that evicts them.
    readonly cacheUrl: string;
    readonly queueUrl: string;
    // Live frames. Absent means the cache instance, which is the right default until
    // fan-out is heavy enough to compete with session reads.
    readonly realtimeUrl?: string;
  };
  readonly storage: {
    readonly endpoint: string;
    readonly region: string;
    readonly bucket: string;
    readonly accessKey: string;
    readonly secretKey: string;
    readonly forcePathStyle: boolean;
    // The colder class the `cold/` prefixes move to, from `S3_COLD_STORAGE_CLASS` and
    // `S3_COLD_TRANSITION_DAYS` — `25.3`. Absent is no transition at all.
    readonly coldTier?: { readonly storageClass: string; readonly afterDays: number };
  };
  // Optional, because `apps/worker` never issues or validates a session and must not
  // carry an AUTH_SECRET it has no use for (25.2). Absent means no `AuthFactory`.
  readonly auth?: {
    readonly secret: string;
    readonly baseUrl: string;
    readonly trustedOrigins: readonly string[];
    readonly sessionMaxAgeSeconds: number;
    readonly cookieCacheMaxAgeSeconds: number;
    readonly requireEmailVerification: boolean;
    readonly appName: string;
    // Which of the three `MembershipEnroller`s this container binds. The one place in
    // the system that branches on it is `Container`, which is what a DI root is for.
    readonly enrolmentMode: "personal" | "bootstrap" | "invite";
    // Absent switches Google sign-in off. Built only when both halves are present, so
    // a half-filled `.env` disables the provider rather than failing at consent.
    readonly google?: { readonly clientId: string; readonly clientSecret: string };
    // Read only under `enrolmentMode: "bootstrap"`. The organization every sign-up
    // joins — first one in as `owner`, everyone after as `member`.
    readonly bootstrapOrganizationSlug?: string;
    // The ceiling on tenants one account may found. The rate limit on the endpoint
    // bounds the rate; this bounds the total.
    readonly maxOwnedOrganizations: number;
  };
  // Not optional: with `requireEmailVerification` on, a container that cannot send is
  // one whose sign-ups never complete. SMTP, so swapping vendors is this URL.
  readonly email: {
    readonly url: string;
    readonly from: string;
    // The origin a link in a message points at. Separate from `auth.baseUrl`, which is
    // Better Auth's own: the worker sends invitation mail and has no auth config at all.
    readonly baseUrl: string;
  };
  readonly embedding: {
    readonly apiKey: string;
    readonly model: string;
    readonly dimensions: number;
  };
  readonly realtime: {
    // Per process, not per cluster: a shared counter would cost a round trip on every
    // stream open, and the failure it prevents is one runaway tab.
    readonly maxStreamsPerUser: number;
    // A stream that has been open this long ends and the client reconnects, which is
    // what stops a leaked reader holding a channel for the life of the process.
    readonly streamMaxAgeSeconds: number;
  };
  // ── the swappable stores ───────────────────────────────────────────────────
  // Two blocks, each naming a `driver` the container switches on. Lite has no analytics
  // store, so no third block. See docs/reference/container.md.
  readonly vector: {
    // `pgvector` today. Rebuildable by re-embedding the sources, which is why a
    // dedicated store can be adopted without a migration plan.
    readonly driver: "pgvector";
  };
  // Absent means no `LogReader`. Diagnostics are still written to stdout either way;
  // this only decides whether anything in-process can read them back.
  readonly logs?: {
    readonly driver: "loki";
    readonly url: string;
    // Loki's multi-tenancy header. Unset locally, set on Grafana Cloud — which is why
    // this is a config field rather than a migration.
    readonly tenantId?: string;
  };
  readonly logging: {
    readonly level: LogLevel;
    // Never true in production: Alloy wants one JSON object per line and nothing else.
    readonly pretty: boolean;
    // Two of the four log labels. Low-cardinality by construction.
    readonly app: string;
    readonly env: string;
  };
}
