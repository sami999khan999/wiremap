# 15 · `@loadbearing/infrastructure` — the non-Postgres adapters

> Redis caching, S3 file storage, the BullMQ queue publisher, the embedding provider, and the two
> opt-in stores: ClickHouse and Loki. Server-only.

**Delivers:** `RedisCacheStore`, `S3StorageGateway`, `BullMqQueuePublisher`, `RedisConnection`, the
embedding provider from [14](14-vector-store.md), `ClickHouseAnalyticsProjector`, and
`LokiLogReader`.

**Prerequisite:** [14 · Vector Storage](14-vector-store.md)

---

## Why this package exists

Every concrete adapter the system owns lives here, behind a port declared in `application` — the Postgres ones from [13](13-infrastructure-postgres.md) and [14](14-vector-store.md) included. The alternative is to construct them in `apps/`, and that means duplication: `apps/web` and `apps/worker` both need S3 and Redis, so each app would carry its own copy of the retry policy, the key layout, and the presign expiry — which will drift.

So the adapters get one server-only package, exactly the way `auth` got one, organised by vendor rather than by capability ([00](00-README.md), departure 1). The dependency direction is the one every adapter obeys: it implements ports declared in `application`, and `application` never imports it.

### What belongs here, and what only looks like it does

One test, and it is not "is this infrastructure":

> **Does application code import a client for it, to satisfy a port declared in
> `application/src/port/`?**

Both halves matter. A node-only client with no port is a dependency a use-case can reach directly,
which is the coupling `port/` exists to prevent. A port with no client is an abstraction over
nothing.

| Thing | Where | Why |
|---|---|---|
| Redis, S3, BullMQ, the embedding provider | **here** | A client, and a port each satisfies |
| **ClickHouse** | **here** | `AnalyticsProjector` — write-only; the read seam is deliberately absent, see [12](12-application-package.md) |
| **Postgres** | **here**, in `src/pg/` | Folded in from the separate database package — see [13](13-infrastructure-postgres.md) |
| **SMTP** | **here**, in `src/smtp/` | `EmailSender`. SMTP rather than a provider's HTTP API, so a vendor swap is a URL |
| **Loki** | **here, the read side only** | `LogReader`. Nothing in `packages/` writes to it |
| **Alloy** | **nowhere in `packages/`** | A separate process that tails stdout. No client, no port |

**The Loki row is the one worth understanding**, because it is two different answers in one line and
"we use Loki, so the Loki thing goes in the infrastructure package" is a reasonable-sounding sentence
that would undo half a deliberate design.

**The write path has no seam, because it has no dependency.** `JsonLogger` writes structured JSON to
stdout and has never heard of Loki. Alloy — a *separate process* — tails that stdout and ships it.
There is no library to install on that side, which is precisely what makes swapping the log platform
a config change instead of a migration ([Data and scale](../opinions/data-and-scale.md)).

**The read path has one, because reading back is a query against an HTTP API.** `LokiLogReader`
implements `LogReader`, is built only when `LOKI_URL` is set, and exists for the operator surface that
knows what an organization is — the one thing a generic log console cannot know. It is `fetch` against
`query_range`; there is still no library.

The moment `@loadbearing/observability` imports a Loki client, three things break at once: the
package gains a runtime dependency it has spent its whole design avoiding, the log platform stops
being swappable, and a browser bundle acquires a server-only import. **That constraint is on
`observability`, and this package is where the read adapter goes precisely so `observability` never
needs one.** The containers live in `infra/docker-compose.yml` ([11](11-local-infrastructure.md)) as
[Tier 0](../opinions/dependencies.md) — provided by the deployment, reached over a protocol the code
was going to speak anyway.

**Smell:** a `*.dashboard.json`, or a `loki` / `@clickhouse/client` entry in any `package.json`. Both
adapters here are `fetch` against a documented HTTP API, for the same reason
`OpenAiEmbeddingProvider` is: one dependency fewer, and a stable request shape.

```
packages/infrastructure/src/
├── index.ts                              ← ServerOnly.assert()
├── import.ts                             ← every external symbol, vendor SDKs included
├── pg/                                   ← Postgres, and the biggest tenant — see 13
├── redis/
│   ├── index.ts
│   ├── redis.connection.ts               → RedisConnection
│   └── redis-cache.store.ts              → RedisCacheStore
├── s3/
│   ├── index.ts
│   ├── s3-storage.gateway.ts             → S3StorageGateway
│   └── storage-key.ts                    → StorageKey
├── bullmq/
│   ├── index.ts
│   └── bullmq-queue.publisher.ts         → BullMqQueuePublisher
├── openai/
│   ├── index.ts
│   └── openai-embedding.provider.ts      → OpenAiEmbeddingProvider
├── clickhouse/                           ← opt-in: built only when configured
│   ├── index.ts
│   ├── clickhouse.connection.ts          → ClickHouseConnection
│   └── clickhouse-analytics.projector.ts → ClickHouseAnalyticsProjector
├── loki/                                 ← opt-in: built only when LOKI_URL is set
│   ├── index.ts
│   └── loki-log.reader.ts                → LokiLogReader
├── smtp/
│   ├── index.ts
│   └── smtp-email.sender.ts               → SmtpEmailSender  ← behind the EmailSender port
└── smoke/
    └── index.ts                          ← the wiring check, run against live containers
```

**One folder per external system, and the system is the only subject.** `ls src/` answers "what does
this package depend on?" in one line. The filenames already led with the technology
([Files](../opinions/files.md)); the folders agree with them.

The folders used to name the *seam* — `cache/`, `storage/`, `queue/`, `embedding/`, `analytics/` — and
that broke the first time a port got a second implementation. `pg/analytics/` beside `clickhouse/`
reads as two different things; `pg/repository/pg-analytics.reader.ts` beside
`clickhouse/clickhouse-analytics.reader.ts` reads as what it is. **One axis, and it is the vendor.**

> [!NOTE]
> **A folder here means the seam is implemented, not that the store is running.** `clickhouse/` and
> `loki/` are behind opt-in compose profiles, and `Container` builds neither unless its config block
> is present. Those are two separate decisions and only the second one costs anything to be wrong
> about — see [reference/clickhouse](../../packages/infrastructure/docs/reference/clickhouse.md).

**`packages/infrastructure/src/index.ts`**

```ts
import { ServerOnly } from "./import.js";

ServerOnly.assert("@loadbearing/infrastructure");

export { BullMqQueuePublisher } from "./bullmq/index.js";
export {
  ClickHouseAnalyticsProjector,
  type ClickHouseConfig,
  ClickHouseConnection,
} from "./clickhouse/index.js";
export { type LokiConfig, LokiLogReader } from "./loki/index.js";
export { type OpenAiEmbeddingConfig, OpenAiEmbeddingProvider } from "./openai/index.js";
export { /* Database, BaseRepository, every Pg* adapter */ } from "./pg/index.js";
export { RedisCacheStore, type RedisConfig, RedisConnection, type RedisRole } from "./redis/index.js";
export { type S3Config, S3StorageGateway, StorageKey } from "./s3/index.js";
```

Read that list against `container.ts` ([17](17-composition-container.md)) and every name lines up with
one `port` binding — which is the property that makes the container the only file in the repository
knowing both an abstract port and the concrete class behind it.

---

## Step 15.1 — `RedisConnection`

Redis is doing three jobs — cache, session secondary store, and BullMQ backing store — and they do not have the same durability requirements. **Two instances, and one class owns which is which.**

**`packages/infrastructure/src/redis/redis.connection.ts`**

```ts
import { Redis, type RedisOptions } from "ioredis";

export interface RedisConfig {
  // Evicts under pressure. Everything on it rebuilds from Postgres.
  readonly cacheUrl: string;
  // Never evicts. A queued job is derived from nothing.
  readonly queueUrl: string;
  readonly keyPrefix?: string;
}

// Which instance a consumer is asking about. `healthy()` takes it rather than handing
// out a client, so `Container` never names `Redis` ([17](17-composition-container.md)).
export type RedisRole = "cache" | "queue";

export class RedisConnection {
  private readonly clients = new Map<RedisRole, Redis>();

  public constructor(private readonly config: RedisConfig) {}

  // Cache and session reads. Prefixed, and safe to share.
  public client(): Redis {
    return this.resolve("cache");
  }

  // BullMQ requires `maxRetriesPerRequest: null` and its own key namespace.
  // Sharing a prefixed client with the cache corrupts queue keys.
  public queueClient(): Redis {
    return this.resolve("queue");
  }

  // PING on the instance callers actually hold. Opening a second connection to answer
  // this would report on a socket nothing else uses — green while the cache is down.
  public async healthy(role: RedisRole): Promise<boolean> {
    try {
      return (await this.resolve(role).ping()) === "PONG";
    } catch {
      return false;
    }
  }

  // One client per role, memoised. Without this, `client()` called twice is two TCP
  // connections, and the second one is invisible until the connection count is the symptom.
  private resolve(role: RedisRole): Redis {
    const existing = this.clients.get(role);
    if (existing) return existing;

    const created =
      role === "cache"
        ? this.create(this.config.cacheUrl, { keyPrefix: this.config.keyPrefix ?? "ratchet:" })
        : this.create(this.config.queueUrl, {
            maxRetriesPerRequest: null,
            enableReadyCheck: false,
          });

    this.clients.set(role, created);
    return created;
  }

  private create(url: string, options: RedisOptions): Redis {
    return new Redis(url, {
      lazyConnect: false,
      enableAutoPipelining: true,
      retryStrategy: (attempt) => Math.min(attempt * 200, 5_000),
      ...options,
    });
  }

  public async close(): Promise<void> {
    await Promise.all([...this.clients.values()].map((c) => c.quit()));
    this.clients.clear();
  }
}
```

**`healthy(role)` takes the role rather than handing out a `Redis`, and that is what keeps `ioredis` confined to this package.** `Container.healthy()` ([17](17-composition-container.md)) checks Postgres and *both* Redis instances; if it had to reach a client to ping it, `packages/composition` would import `ioredis` and the vendor-confinement grep at the top of this document would stop returning nothing.

**One client per role, memoised, and the memoisation is load-bearing for the health check.** An earlier draft created a fresh connection on every `client()` call, which meant a health check pinged a socket that nothing else was using — reporting green while the connection the cache store actually held was down. It also meant two consumers were two connections, silently.

**`maxRetriesPerRequest: null` for the queue client is not optional** — BullMQ's blocking commands sit open indefinitely, and ioredis's default retry limit kills them. The symptom is workers that stop consuming after a few minutes with no error, which is a genuinely unpleasant thing to debug.

**`keyPrefix` on the cache client, none on the queue client.** ioredis prepends the prefix to every key transparently, which is exactly what you want for cache keys and exactly what breaks BullMQ, whose key structure it manages itself.

**`enableAutoPipelining: true`** batches commands issued in the same tick into one round trip. On the capability-cache path — several `get` calls while building a principal — that is a real latency saving for one line.

**Two URLs, not one, in every environment.** The cache instance runs `allkeys-lru`; the queue instance runs `noeviction` with AOF. Locally they are two containers ([11](11-local-infrastructure.md)), because a split that exists only in production is a code path first exercised on deployment day.

The reason it is one class taking two URLs rather than two classes: **which connection a consumer gets should be a property of what it is doing, not a wiring decision made in the container.** `RedisCacheStore` asks for `client()`, `BullMqQueuePublisher` asks for `queueClient()`, and neither can accidentally receive the other. Passing two bare `Redis` instances into `Container` puts that choice at a call site where the two arguments have the same type and swapping them compiles.

> **This is a correctness boundary, not tuning.** Anything reached through `client()` can vanish under memory pressure — so it must be a cache in front of a durable store, never the store. Better Auth's secondary storage sits on this connection ([16](16-auth-package.md)), which is exactly why sessions stay in Postgres and Redis is only a read-through in front of them.

---

## Step 15.2 — `RedisCacheStore`

**`packages/infrastructure/src/redis/redis-cache.store.ts`**

```ts
import type { Redis } from "ioredis";
import { CacheStore } from "@loadbearing/application";

export class RedisCacheStore extends CacheStore {
  constructor(private readonly redis: Redis) {
    super();
  }

  public override async get<T>(key: string): Promise<T | null> {
    const raw = await this.redis.get(key);
    if (raw === null) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      // A corrupt entry is a cache miss, never an error. Evict and move on.
      await this.redis.del(key);
      return null;
    }
  }

  public override async set<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
    await this.redis.set(key, JSON.stringify(value), "EX", ttlSeconds);
  }

  public override async delete(key: string): Promise<void> {
    await this.redis.del(key);
  }

  // SCAN, never KEYS — KEYS blocks the server for the duration of the scan.
  public override async deletePrefix(prefix: string): Promise<void> {
    const keyPrefix = this.redis.options.keyPrefix ?? "";
    const pattern = `${keyPrefix}${prefix}*`;
    let cursor = "0";

    do {
      const [next, keys] = await this.redis.scan(cursor, "MATCH", pattern, "COUNT", 200);
      cursor = next;
      if (keys.length > 0) {
        await this.redis.unlink(...keys.map((key) => key.slice(keyPrefix.length)));
      }
    } while (cursor !== "0");
  }
}
```

### Three things worth knowing

**A corrupt entry is a miss, not a throw.** Cache deserialisation failures happen after a deploy that changed a DTO shape. Throwing turns a stale cache into an outage; evicting and falling through turns it into a brief latency bump.

**`SCAN` with `UNLINK`, never `KEYS` with `DEL`.** `KEYS` is O(n) over the entire keyspace and blocks Redis while it runs — on a production instance that is a multi-second stall for every other consumer. `UNLINK` frees memory on a background thread rather than inline.

**The `keyPrefix` asymmetry cuts both ways, and `deletePrefix` has to handle each.** ioredis applies `keyPrefix` to key arguments but not to `SCAN` — so the `MATCH` pattern needs it **added**, and the keys `SCAN` hands back need it **stripped** before they go to `unlink`.

> [!WARNING]
> **Missing the second half is silent.** `SCAN` returns fully-prefixed keys; passing them straight to `unlink` prefixes them a second time, and `UNLINK` on a key that does not exist is not an error. The prune reports success and deletes nothing. Verified against a running Redis: `ratchet:smoke:probe` survived the call, and `ratchet:ratchet:smoke:probe` was what the command actually targeted.
>
> It matters more than a cache bug usually would, because `deletePrefix` is how capability invalidation works ([16](16-auth-package.md)) — a silently broken prune is a user who keeps permissions after their role changed.

### Key naming

```
<subject>:<identifier>[:<qualifier>]
```

`capability:user:<userId>`, `session:<sessionId>`, `content:message:en`. Colon-separated, and the **prefix must be prunable** — `deletePrefix("capability:user:")` has to mean something. That constraint is why the user ID goes last in the capability key rather than first.

---

## Step 15.3 — `S3StorageGateway`

**`packages/infrastructure/src/s3/storage-key.ts`**

```ts
import { Uuid } from "@loadbearing/core";

export class StorageKey {
  private constructor() {}

  // `<subject>/<yyyy>/<mm>/<uuid>.<ext>` — date-partitioned, never user input.
  public static build(subject: string, originalFilename: string, at: Date): string {
    const year = at.getUTCFullYear();
    const month = String(at.getUTCMonth() + 1).padStart(2, "0");
    const extension = StorageKey.extensionOf(originalFilename);
    return `${subject}/${year}/${month}/${Uuid.v7()}${extension}`;
  }

  private static extensionOf(filename: string): string {
    const match = /\.([a-z0-9]{1,8})$/i.exec(filename);
    return match ? `.${match[1]!.toLowerCase()}` : "";
  }
}
```

**Never put a user-supplied filename in a key.** Path traversal, unicode normalisation collisions, and length limits are all live problems, and none of them are worth solving when a UUID solves all three. Keep the display name in the database row next to the key.

**Date-partitioned** because lifecycle rules, cost reports, and bulk deletes all work on prefixes. A flat bucket with a million objects is painful in a way that only becomes apparent when you need to delete last year's.

**`packages/infrastructure/src/s3/s3-storage.gateway.ts`**

```ts
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { StorageGateway, type StoredObject } from "@loadbearing/application";
import { NotFoundError } from "@loadbearing/errors";

export interface S3Config {
  readonly endpoint: string;
  readonly region: string;
  readonly bucket: string;
  readonly accessKey: string;
  readonly secretKey: string;
  // true for MinIO, false for AWS.
  readonly forcePathStyle: boolean;
}

export class S3StorageGateway extends StorageGateway {
  private readonly s3: S3Client;

  constructor(private readonly config: S3Config) {
    super();
    this.s3 = new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      forcePathStyle: config.forcePathStyle,
      credentials: { accessKeyId: config.accessKey, secretAccessKey: config.secretKey },
    });
  }

  public override async put(
    key: string,
    body: Uint8Array,
    contentType: string,
  ): Promise<StoredObject> {
    const checksum = await S3StorageGateway.sha256(body);

    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.config.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
        ChecksumSHA256: Buffer.from(checksum, "hex").toString("base64"),
      }),
    );

    return { key, size: body.byteLength, contentType, checksum };
  }

  public override async get(key: string): Promise<Uint8Array> {
    const result = await this.s3.send(
      new GetObjectCommand({ Bucket: this.config.bucket, Key: key }),
    );
    if (!result.Body) throw new NotFoundError("storage.object", key);
    return new Uint8Array(await result.Body.transformToByteArray());
  }

  public override async delete(key: string): Promise<void> {
    await this.s3.send(new DeleteObjectCommand({ Bucket: this.config.bucket, Key: key }));
  }

  public override async exists(key: string): Promise<boolean> {
    try {
      await this.s3.send(new HeadObjectCommand({ Bucket: this.config.bucket, Key: key }));
      return true;
    } catch {
      return false;
    }
  }

  public override async presignUpload(
    key: string,
    contentType: string,
    expiresInSeconds: number,
  ): Promise<string> {
    return getSignedUrl(
      this.s3,
      new PutObjectCommand({ Bucket: this.config.bucket, Key: key, ContentType: contentType }),
      { expiresIn: expiresInSeconds },
    );
  }

  public override async presignDownload(key: string, expiresInSeconds: number): Promise<string> {
    return getSignedUrl(this.s3, new GetObjectCommand({ Bucket: this.config.bucket, Key: key }), {
      expiresIn: expiresInSeconds,
    });
  }

  private static async sha256(body: Uint8Array): Promise<string> {
    const digest = await crypto.subtle.digest("SHA-256", body);
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  }
}
```

### The upload flow

The gateway supports both, and which one a feature uses is a domain decision:

**Direct-to-S3 (default for user uploads).** The use-case authorizes, generates a key, returns a presigned PUT URL. The browser uploads straight to storage; the app server never sees the bytes. A second call confirms and writes the database row. This is what keeps a 50 MB receipt off your request path entirely.

**Through the server (for generated files).** A PDF the worker renders, an export the system builds. There is no browser involved and `put()` is the whole story.

**Never return a permanent public URL.** `presignDownload` with a short expiry — five minutes is generous — and the bucket stays private (`mc anonymous set none` in [11](11-local-infrastructure.md)). A public URL is a permanent, unauthenticated, unrevocable grant, and it will end up in a support ticket, then a shared inbox, then a search index.

**Expiry belongs to the caller, not the gateway.** A download link embedded in an email needs longer than one rendered in a live UI. Making it a parameter means that is a use-case decision rather than a config value someone raises to seven days for one feature.

**`ChecksumSHA256` on every put.** S3 verifies it server-side and rejects a corrupt transfer instead of silently storing truncated bytes. Storing the checksum on the returned `StoredObject` also gives deduplication and integrity checking for free later.

---

## Step 15.4 — `BullMqQueuePublisher`

**`packages/application/src/primitive/queue-name.ts`**

> [!NOTE]
> **It lives in `application`, not here.** Which queue a job belongs on is a domain
> decision — `QueueDocumentIndexUseCase` names `QueueName.EMBEDDING` — and `application`
> cannot import this package. It is a closed vocabulary of strings, like the permission
> catalog, so it sits beside `Principal` and `Authorizer` rather than beside the adapter
> that happens to consume it.

```ts
const EMBEDDING = "embedding";
const NOTIFICATION = "notification";
const ANALYTICS = "analytics";
const MAINTENANCE = "maintenance";
const MAIL = "mail";
const EVENT = "event";

// Frozen at module load rather than left as a `static readonly`: the keyword freezes the
// binding and not the array, which is the shape `docs/ai/rules/classes.md` bans.
const ALL = Object.freeze([EMBEDDING, NOTIFICATION, ANALYTICS, MAINTENANCE, MAIL, EVENT] as const);

// A handful of queues by concern, not one per job type. A queue is a concurrency
// and priority boundary: embedding is slow and rate-limited, notifications bursty.
export class QueueName {
  private constructor() {}

  public static readonly EMBEDDING = EMBEDDING;
  public static readonly NOTIFICATION = NOTIFICATION;
  // Its own concern because it is allowed to fall behind — nobody waits on a
  // dashboard row, and its depth is the health signal for the derived store.
  public static readonly ANALYTICS = ANALYTICS;
  public static readonly MAINTENANCE = MAINTENANCE;
  // Its own concern because a provider's rate limit is a property of this queue and of
  // nothing else: one limiter here beats a sleep in every caller.
  public static readonly MAIL = MAIL;
  // The outbox drain and the deliveries it fans out to. Its own concern because the
  // drain must not queue behind the deliveries it just created.
  public static readonly EVENT = EVENT;

  public static readonly ALL = ALL;
}
```

> **`ALL` is frozen at module load, and that is not style.** A
> `public static readonly ALL = [...]` freezes the *binding*, not the array — `ALL.push(…)` still
> mutates it — which is the static mutable state [classes](../ai/rules/classes.md) bans. The
> members are module constants for the same reason: one place declares each string, and the class
> is a view onto it.

> **A queue with no producer and no consumer is deleted, not reserved.** `DOCUMENT` was on this
> list until `23.4`: `5.5` indexed documents through `EMBEDDING`, so nothing ever published to it
> and nothing ever read it. A name in a closed union is a promise that something uses it, and the
> next person to see it spends an hour looking for what.

**A handful of queues by concern, not one per job type.** Queues are a concurrency and priority boundary: embedding is slow and rate-limited, notifications are fast and bursty, and you want to tune those separately. Fifty queues means fifty Redis connections and fifty things to monitor.

**`MAIL` is its own concern because a provider's rate limit belongs to it and to nothing else.** Every managed sender caps messages per second, and the only place that cap can be expressed once is a BullMQ `limiter` on the worker consuming this queue. Sharing a queue with anything else would either throttle that other work or leak the cap into every caller as a sleep. It is also the queue whose jobs carry no state of their own: there is no delivery table, so retries, backoff and duplicate suppression by job id are the whole error model.

**`ANALYTICS` is its own concern because it is allowed to fall behind.** Projecting domain events into snapshot tables is the one workload here where lag is acceptable and throughput matters more than latency — nobody is waiting on a dashboard row. Sharing a queue with notifications would let a backlog of projections delay something a user is actually waiting for. It is also the queue whose depth is the health signal for the derived store: a consumer that died on Tuesday shows up here before it shows up in a wrong quarterly number ([Data and scale](../opinions/data-and-scale.md) §2).

**`packages/infrastructure/src/bullmq/bullmq-queue.publisher.ts`**

```ts
import { Queue } from "bullmq";
import type { Redis } from "ioredis";
import { QueuePublisher, type JobOptions } from "@loadbearing/application";

export class BullMqQueuePublisher extends QueuePublisher {
  private readonly queues = new Map<string, Queue>();

  constructor(private readonly connection: Redis) {
    super();
  }

  public override async publish<T>(
    queue: string,
    payload: T,
    options?: JobOptions,
  ): Promise<void> {
    await this.queueFor(queue).add(queue, payload, {
      delay: options?.delayMs,
      attempts: options?.attempts ?? 3,
      jobId: options?.jobId,
      backoff: { type: "exponential", delay: 2_000 },
      removeOnComplete: { age: 3_600, count: 1_000 },
      removeOnFail: { age: 86_400 },
    });
  }

  private queueFor(name: string): Queue {
    const existing = this.queues.get(name);
    if (existing) return existing;
    const created = new Queue(name, { connection: this.connection });
    this.queues.set(name, created);
    return created;
  }

  public async close(): Promise<void> {
    await Promise.all([...this.queues.values()].map((q) => q.close()));
    this.queues.clear();
  }
}
```

**`removeOnComplete` and `removeOnFail` are mandatory, not tuning.** BullMQ keeps completed jobs forever by default. A queue processing ten jobs a second accumulates about a million records a day, and the first symptom is Redis running out of memory — which, with `noeviction`, means everything stops. Keeping an hour of successes and a day of failures gives you enough to debug with and a bounded footprint.

> **A consequence worth stating, because it decides how the recovery sweep is built.** These retention windows mean job history is *not* a durable record of what happened — an hour after a success, and a day after a failure, the evidence is gone. So the nightly sweep that re-enqueues unprocessed work cannot ask BullMQ what it missed; by the time it runs, there is nothing to ask.
>
> It reconciles against Postgres instead: *which domain rows should have been processed and have not been?* That query works whether the job was lost to a `FLUSHALL`, a crash between enqueue and persist, or a bug that dropped it silently — and it is the reason handlers must be idempotent, since a re-enqueued job may be a duplicate rather than a replacement ([25](25-worker-app.md)).

**`jobId` is the deduplication key**, and it comes from the port because idempotency is a domain rule. `jobId: "embed:receipt:<id>"` means enqueuing twice produces one job — which is exactly what you want when a retry re-publishes.

**A `jobId` holds only while the job is kept.** Once the completed set trims it, which the count cap does early on a busy queue, the same id enqueues again. Two more options cover what that cannot. `inFlightId` holds while a job is waiting or running and frees at once, for an operator's request. `onceWithin: { id, seconds }` holds for a fixed window whether the job finished or not, because BullMQ keeps it as its own key with a TTL. Mail uses it, with a day (`RV.5`).

**Exponential backoff from the first attempt.** A downstream service that is down does not recover faster because you retried three times in two seconds.

**Consumers live in `apps/worker`, not here.** This package publishes. See [25](25-worker-app.md).

---

## Step 15.5 — The two opt-in stores

Both are `fetch` against a documented HTTP API. No `@clickhouse/client`, no Loki SDK — the same
choice `OpenAiEmbeddingProvider` makes, and for the same reasons: the request shape is stable, the
dependency count stays where it is, and both stores stay [Tier 0](../opinions/dependencies.md)
dependencies reached over a protocol this runtime already speaks.

### `src/clickhouse/` — the derived analytics store

Three files, and the split between them is a guard rather than an organisational preference.

| Class | Port | Reachable from |
|---|---|---|
| `ClickHouseConnection` | — | the projector below |
| `ClickHouseAnalyticsProjector` | `AnalyticsProjector` | the worker, only |

**A single class with both would put `project()` on the object a dashboard query holds.** *Nothing
writes to ClickHouse except the projection* is the first of the two guards that keep the store
derived, and a merged port makes it unenforceable.

Three things `ClickHouseConnection` does that are easy to get wrong by hand:

- **Server-side bound parameters, never interpolation.** ClickHouse reads `{name:Type}` placeholders
  out of `param_*` query-string entries. The analytics store holds every tenant's rows in one table,
  so an injected predicate here is a cross-tenant read. **An array parameter is the exception**: it
  goes over as a literal, so its elements are escaped — a scalar is never quoted and needs none.
- **Table names qualified against the configured database.** ClickHouse resolves an unqualified name
  against the session default, which is `default` — the same trap the init script documents, and the
  reason a table can look missing while it exists.
- **`DateTime64(3)` is `YYYY-MM-DD HH:MM:SS.mmm`.** An ISO string's `T` and `Z` are rejected.

The full mechanics — the checkpoint, the keyset, the `ReplacingMergeTree` dedup, the reconciliation —
are in [reference/clickhouse](../../packages/infrastructure/docs/reference/clickhouse.md).

### `src/loki/` — the read side of the diagnostic stream

One file, one method that matters, and a type that refuses to express a bad query:

```ts
interface LogQuery {
  from: Date; to: Date;
  app?: string; env?: string; level?: string; eventCode?: string;   // the four labels
  contains?: string;                                                // the line body
  limit?: number;
}
```

**A label creates one stream per distinct value.** `user_id` at 100k users means 100k streams and Loki
falls over — the most common way a Loki deployment fails, and entirely avoidable. Here the avoidance
is not a convention: `LogQuery` has no field that could produce one. High-cardinality fields go in
`contains`, which becomes a line filter applied *after* the selector has narrowed the streams.

Details in [reference/loki](../../packages/infrastructure/docs/reference/loki.md).

---

## Step 15.6 — Barrels

```ts
// packages/infrastructure/src/redis/index.ts
export { RedisCacheStore } from "./redis-cache.store.js";
export { type RedisConfig, RedisConnection, type RedisRole } from "./redis.connection.js";
```

```ts
// packages/infrastructure/src/s3/index.ts
export { type S3Config, S3StorageGateway } from "./s3-storage.gateway.js";
export { StorageKey } from "./storage-key.js";
```

```ts
// packages/infrastructure/src/bullmq/index.ts
export { BullMqQueuePublisher } from "./bullmq-queue.publisher.js";
```

```ts
// packages/infrastructure/src/clickhouse/index.ts
export { ClickHouseAnalyticsProjector } from "./clickhouse-analytics.projector.js";
export { type ClickHouseConfig, ClickHouseConnection } from "./clickhouse.connection.js";
```

```ts
// packages/infrastructure/src/loki/index.ts
export { type LokiConfig, LokiLogReader } from "./loki-log.reader.js";
```

```ts
// packages/infrastructure/src/openai/index.ts
export {
  type OpenAiEmbeddingConfig,
  OpenAiEmbeddingProvider,
} from "./openai-embedding.provider.js";
```

Folder barrels name their exports for the same reason root barrels do — and here it buys something concrete: a vendor adapter can keep its private helpers exported for a sibling file without those helpers becoming part of `@loadbearing/infrastructure`.

---

## Step 15.7 — A smoke suite

Not a unit test — these classes are adapters, and testing an adapter against a fake tests the fake.
`packages/infrastructure/tests/smoke/` exercises every one of them against the running containers,
and it is a vitest suite rather than a script for one reason: a script that prints is checked by a
person reading the output, and nobody reads the output of a step that exits 0.

```bash
pnpm smoke
```

It runs under its own config, `vitest.smoke.config.ts`, and the default `vitest run` excludes
`tests/smoke/**`. The split is what lets the rest of the suite need only Postgres while this half
needs S3, Loki and both Redis instances — and it is why `pnpm test` on a laptop with nothing running
still tells you something. The smoke config loads the repository root `.env`, runs the files
serially, and allows thirty seconds a test: two suites racing on the same bucket and the same queue
key is a flake that only reproduces on a fast machine.

**The two opt-in stores skip with a named reason rather than silently.** `describe.skipIf` on
`LOKI_URL` and `CLICKHOUSE_URL`, so a stack without them reports `skipped` in the summary — a suite
that silently contains no tests is indistinguishable from one that ran.

**This is the only exercised path three ports have.** `StorageGateway.presignUpload` and
`presignDownload` are used by the browser and by nothing in this repository, so a URL that is wrong
is wrong in a browser and nowhere else: the suite signs one of each and actually fetches and PUTs
through them. `QueuePublisher.publish` is the port's whole write surface, and the job is read back
through BullMQ's own `getJob` rather than off a Redis key — the key layout is theirs to change, and
a spec that pins it fails on an upgrade that broke nothing. `LogReader.query` runs a real
`query_range` and asserts the shape of every entry it parses, and deliberately nothing about a
particular line: that would make the check depend on something having been logged recently, which is
a flaky test rather than a wiring check.

The ClickHouse probe inserts **the same row twice** and expects to read back one. That is not a
formality: the projection consumer's idempotency rests entirely on `ReplacingMergeTree` collapsing a
redelivered batch, and an `ENGINE = MergeTree` typo in the init script stays invisible until a
redelivery doubles a quarter's numbers.

The storage probe asserts the read-back *after* `deletePrefix` and after `delete`. Without those
lines the prune reported success while deleting nothing — `SCAN` returns fully-prefixed keys, and
passing them straight to `unlink` prefixes them a second time.

**The `compose` CI job runs it** ([26](26-hygiene-and-ci.md)), against the containers
`infra/docker-compose.yml` actually starts, which is the only place `LOKI_URL` is set.

---

## ✅ Gate

`pnpm smoke` passes against a booted stack: a cache round-trip and its prune, a storage
round-trip, both presigned URLs actually used, a published job read back, and Loki answering a
query — with ClickHouse skipped by name unless `CLICKHOUSE_URL` is set.

```bash
grep -rn "ioredis\|@aws-sdk\|bullmq" packages --include=*.ts | grep -v "packages/infrastructure"
```

Returns nothing. Those three dependencies appear in exactly one package.

Do not proceed until this passes.

---

[← Vector Storage](14-vector-store.md) · [`@loadbearing/auth` →](16-auth-package.md)
