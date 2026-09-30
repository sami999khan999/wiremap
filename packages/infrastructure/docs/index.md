---
title: "@loadbearing/infrastructure"
description: Every concrete adapter the system owns, behind a port and confined to one package — Postgres and its schema, Redis, S3, BullMQ, SMTP and the embedding providers.
---

# `@loadbearing/infrastructure`

The package that owns `drizzle-orm`, `pg`, `ioredis`, `@aws-sdk/*` and `bullmq`, so nothing else has
to. Each class implements a port from [`@loadbearing/application`](../../application/docs/index.md),
and the `Container` decides which one to build.

```bash
grep -rn "drizzle-orm\|ioredis\|@aws-sdk\|bullmq\|from \"pg\"" packages --include=*.ts   | grep -v "packages/infrastructure"
```

Returns nothing. Every one of them appears in exactly one package, which is the whole claim.

**A separate database package used to sit beside this one, and was folded in.** The two were
siblings with no edge between them. Merging in this direction keeps the name honest: an S3 client in
a package called `db` would be a lie, but Postgres genuinely is infrastructure.

| | |
| --- | --- |
| **Package** | `@loadbearing/infrastructure` (private, never published) |
| **Entrypoint** | `src/index.ts` |
| **Depends on** | `@loadbearing/application` (the ports), `contracts`, `core`, `errors`, `permissions`, plus `drizzle-orm`, `pg`, `ioredis`, `bullmq`, `@aws-sdk/*` |
| **Used by** | `auth`, `composition`, `apps/worker` — **never** a browser bundle |
| **Environment** | server-only; `ServerOnly.assert()` is the runtime tripwire |

```
packages/infrastructure/
├── drizzle.config.ts                      ← build-time artefacts, above src/
├── migrate.ts                             ← the migration runner
├── seed.ts                                ← system roles, idempotent
├── partitions.ts, partition-ddl.ts        ← the partition runway by hand, and the DDL rewrite
├── platform-grant.ts, queue-replay.ts     ← the first platform admin, and failed jobs back on a queue
├── ai-reindex.ts                          ← queues a re-embed after a provider or model change
├── vitest.smoke.config.ts                 ← the wiring check, run against live containers
└── src/
    ├── index.ts
    ├── import.ts                          ← every external symbol, vendor SDKs included
    ├── pg/                                Postgres — the biggest tenant
    │   ├── primitive/   database.ts        → Database, DrizzleClient
    │   │                base.repository.ts → BaseRepository
    │   ├── schema/      *.schema.ts       ← drizzle tables + the barrel drizzle-kit reads
    │   ├── repository/  pg-*.ts           → every adapter, one file each, flat
    │   ├── transaction/ pg-unit-of-work.ts → PgUnitOfWork, TransactionScope
    │   └── seed/        system-role.seed.ts → SystemRoleSeed
    ├── redis/     redis.connection.ts      → RedisConnection, RedisConfig
    │              redis-cache.store.ts     → RedisCacheStore
    │              redis-realtime.*.ts      → RedisRealtimePublisher, RedisRealtimeSubscriber
    ├── s3/        s3-storage.gateway.ts    → S3StorageGateway, S3Config
    │              s3-storage-policy.gateway.ts → S3StoragePolicyGateway
    │              storage-key.ts           → StorageKey
    ├── bullmq/    bullmq-queue.publisher.ts → BullMqQueuePublisher
    ├── smtp/      smtp-email.sender.ts     → SmtpEmailSender
    ├── unified/   unified-markdown.renderer.ts → UnifiedMarkdownRenderer
    ├── gemini/    gemini-embedding.provider.ts → GeminiEmbeddingProvider
    └── openai/    openai-embedding.provider.ts → OpenAiEmbeddingProvider
```

**The runnable scripts sit above `src/`.** A script inside a folder makes that folder's barrel
execute it on import — the failure that moved `seed.ts` out when `PgPersonalOrganizationEnroller`
needed `SystemRoleSeed`. `src/pg/seed/` keeps the class; `seed.ts` is the thing you run.

**One folder per external system**, so `ls src/` answers "what does this package depend on?" in one
line. The filenames already led with the technology ([Files](../../../docs/opinions/files.md) — *"you
should be able to see what you would delete"*); the folders agree with them, which makes each one a
subject folder in the sense [Folders](../../../docs/opinions/folders.md) means.

**The external system is the subject, and it is the only subject.** `pg/repository/` used to be five
folders — `activity/`, `analytics/`, `rbac/`, `vector/`, `maintenance/` — each holding one or two
files. They were flattened for two reasons.

The first is [Simplicity](../../../docs/opinions/simplicity.md): a folder holding one file is a path,
not a subject. The second is what happens when a port gets a second implementation.
`openai/openai-embedding.provider.ts` beside `gemini/gemini-embedding.provider.ts` reads as what it
is — two implementations of one port, each named after the service it speaks to. **The technology is
the axis this package sorts on, and naming the subject twice would break that.**

`tests/smoke/` is the only folder that is not a system: it spans every store at once. And
`pg/schema/` is the one place the subject rule bends — drizzle-kit needs a single barrel naming every
table, so the tables sit together rather than beside the repositories that read them.

**A folder here means the seam is implemented, not that it is used.** `openai/` and `gemini/` are
built only when `EMBEDDING_PROVIDER` names them — see [Embedding](reference/embedding.md).

## What belongs here and what only looks like it does

| Store | Adapter here? | Why |
| --- | --- | --- |
| Redis | **yes** | `CacheStore`, and the connection BullMQ needs |
| S3 / MinIO | **yes** | `StorageGateway` |
| BullMQ | **yes** | `QueuePublisher`. Consumers live in `apps/worker` |
| OpenAI, Gemini | **yes** | `EmbeddingProvider`, one per service |
| SMTP | **yes** | `EmailSender` |
| Postgres | **yes** | `drizzle-orm` + `pg` behind most of the ports, plus the schema and migrations |
| A log platform | **nowhere** | Logs are JSON on stdout. No client, no port, nothing to import |

**The last row is the one worth understanding.** `JsonLogger` writes structured JSON to stdout and
has never heard of a log store. That is what keeps adding one a config change — the write path has no
seam because it has no dependency. Bringing back a collector and a reader is
[Logs](../../../docs/scale/logs.md); a separate analytics store is
[Analytics](../../../docs/scale/analytics.md).

## The swap points, and what makes them real

Two ports have more than one implementation, or are shaped to take one. Each is chosen by a field on
`ContainerConfig` rather than by a `new` in the constructor — so adopting a store is an environment
variable and one `case`, never a change to a use-case, a repository, or a test.

| Port | Chosen by | Today | Next | Trigger |
| --- | --- | --- | --- | --- |
| `VectorStore` | `VECTOR_DRIVER` | `pgvector` | a dedicated vector database | pgvector recall or latency degrades |
| `EmbeddingProvider` | `EMBEDDING_PROVIDER` | `none`, `openai` or `gemini` | another provider | cost or quality |

There was a third. `AnalyticsReader` had a `postgres` and a `clickhouse` implementation behind
`ANALYTICS_DRIVER`, and **nothing ever read through either** — so the port, both adapters and the
flag were deleted rather than kept warm. See [Simplicity](../../../docs/opinions/simplicity.md).

**The `driver` field is what stops "swap the implementation" from being a claim.** A seam with exactly
one implementation is untested by construction. A seam with a discriminated config is exercised the
first time somebody flips the value — and `Container.buildVectorStore` has an exhaustive `switch`, so
a driver added to the union and not to the switch is a build error.

**What makes the vector swap cheap is not the switch.** It is that `VectorStore.search()` takes the
resolved goal scope as a parameter. A remote store holds no `CapabilitySet` and can join back to
nothing, so the permission filter had to run on the input set from the first day or the port would
have been unswappable at any price. `searchText` takes the same scope for the same reason.

## One Redis, two roles, one class

`RedisConnection` takes a URL per role and hands out a client per role, and that is a correctness
boundary rather than tuning. Lite points `REDIS_CACHE_URL` and `REDIS_QUEUE_URL` at the same
instance, which runs `noeviction` so a full Redis refuses writes rather than dropping jobs. Splitting
them is config only — see [Split Redis](../../../docs/scale/split-redis.md).

| | `client()` | `queueClient()` |
| --- | --- | --- |
| URL | `REDIS_CACHE_URL` | `REDIS_QUEUE_URL` |
| Key prefix | `keyPrefix`, `app:` by default | **none** — BullMQ manages its own keys |
| `maxRetriesPerRequest` | default | **`null`**, or blocking commands die |
| Losing a key | a slow minute | **work that never happens** |

`realtimeClient()` and `subscriberClient()` are the other two roles. Both ride the cache URL unless
`REDIS_REALTIME_URL` names another — see [Realtime](reference/realtime.md).

**Which connection a consumer gets is a property of what it is doing**, not a wiring decision. Passing
two bare `Redis` instances into `Container` puts that choice at a call site where both arguments have
the same type and swapping them compiles.

`maxRetriesPerRequest: null` is not optional. BullMQ's blocking commands sit open indefinitely and
ioredis's default retry limit kills them — the symptom is workers that stop consuming after a few
minutes, with no error.

**One client per role, memoised.** `client()` called twice used to be two TCP connections, and the
second one is invisible until the connection count is the symptom. `healthy(role)` then pings the
connection the cache store and the queue publisher are *already* using — opening a fresh one to
answer a health check reports green on a socket nothing else has.

`healthy` takes the role rather than handing out a `Redis`, which is what lets
[`Container.healthy()`](../../composition/docs/reference/container.md) check every role without
`ioredis` ever appearing in `packages/composition`.

## The `keyPrefix` asymmetry, in both directions

ioredis applies `keyPrefix` to key arguments but **not** to `SCAN`. That cuts both ways, and
`deletePrefix` has to handle each:

```ts
const keyPrefix = this.redis.options.keyPrefix ?? "";
const pattern = `${keyPrefix}${prefix}*`;                       // MATCH needs it added
...
await this.redis.unlink(...keys.map((k) => k.slice(keyPrefix.length)));   // and stripped back off
```

**Missing the second half is silent.** `SCAN` returns fully-prefixed keys; handing those straight to
`unlink` prefixes them a second time and deletes nothing, and `UNLINK` on a missing key is not an
error. The smoke check asserts a read-back *after* the prune for exactly this reason — the version
without that line printed a clean run while deleting nothing.

It matters because `deletePrefix` is how capability invalidation works. A silently broken prune means
a user keeps permissions after their role changed.

## Other decisions worth knowing

**A corrupt cache entry is a miss, not a throw — and a logged one.** Deserialisation failures happen
after a deploy that changed a DTO shape. Throwing turns a stale cache into an outage; evicting and
falling through turns it into a latency bump. Silently is the part that was wrong: a deploy that
halves the hit rate looks exactly like one that does not, so the eviction emits
`cache.entry.corrupt` with the key.

**`SCAN` + `UNLINK`, never `KEYS` + `DEL`.** `KEYS` is O(n) over the whole keyspace and blocks the
server while it runs; `UNLINK` frees memory off the main thread.

**Storage keys never contain a filename.** `<subject>/<yyyy>/<mm>/<uuid>.<ext>` — path traversal,
unicode collisions and length limits are three live problems a UUID solves at once. The display name
belongs in the database row.

**`removeOnComplete` and `removeOnFail` are mandatory.** BullMQ keeps completed jobs forever by
default; ten jobs a second is about a million records a day, and on a `noeviction` instance that ends
with everything stopping.

That retention is also why the recovery sweep cannot ask BullMQ what it missed — an hour after a
success the evidence is gone. It reconciles against Postgres instead, which is what makes handler
idempotency a requirement rather than a nicety.

## The smoke check

```bash
pnpm --filter @loadbearing/infrastructure run smoke
```

Not a unit test — these are adapters, and testing an adapter against a fake tests the fake. The files
under `tests/smoke/` run against the live containers. They round-trip the cache, prune it and read
back, count a rate limit, deliver and replay a realtime frame, round-trip an object through S3 with a
checksum, and publish and dedupe jobs. `pooled.smoke.spec.ts` checks what a transaction pooler could
break: the statement timeout, savepoints, advisory locks and the outbox claim.

**The optional parts are checked when they are configured and skipped when they are not.** A second
node (`DATABASE_SHARD_1_URL`), a replica (`DATABASE_REPLICA_URL`) and the scale runs
(`TENANT_CEILING`, `FAN_OUT_SCALE`, `ROUTED_SCALE`) each gate their own file. A run against a stack
without them should say so and pass, rather than fail on a service nobody started.

`vitest.smoke.config.ts` reads `.env` from the repository root explicitly. Under a pnpm filter the
process cwd is this package, so a bare lookup found nothing and every variable came back undefined —
which looks exactly like an unconfigured stack. It throws on a missing required name rather than
guessing one.

## Reference

- [`PgUnitOfWork`](reference/unit-of-work.md) — the transaction scope, and what enrolling a
  repository in one actually means.
- [Enrollers, the founder, and the claimer](reference/enrollers.md) — the advisory locks, the races
  they protect against, and why every one of them binds structurally.
- [Embedding](reference/embedding.md) — `none`, `openai` or `gemini`, lexical search, and what a provider switch does to the corpus
- [pgvector](reference/pgvector.md) — the permission filter on the input set, the score floor, and
  the `ORDER BY` that stops the index being used.
- [Partitions](reference/partitions.md) — the allowlist as the whole policy, the two mechanics that
  are not optional, and which reads prune to one month and which read every one.
- [Sharding](reference/sharding.md) — one key, one node, three placements; why `this.db` stays
  synchronous, and the tripwire that makes one Postgres reveal what a split would break.
- [Notification recipients](reference/notification-recipients.md) — four audiences, the
  correlated `EXISTS` that keeps one a single statement, and the one read that is two on purpose.
- [Cold storage](reference/cold-storage.md) — the tenant export, the 30-day `cold/` archive of a
  deleted tenant, and the sweep that removes it.
- [The bucket's lifecycle policy](reference/storage-policy.md) — why a second gateway, why "no
  configuration" is an error code, and why the app owns the whole configuration rather than a rule.
- [Realtime](reference/realtime.md) — one subscriber connection per process, ref-counted channels,
  and why the overflow is a `resync`.
- [Fan-out](reference/fan-out.md) — the three §6 paths measured against the running stack, why the
  realtime publish was the one to worry about, and what a `users` delete does to a partitioned
  table.
- [The doc renderer](reference/doc-renderer.md) — the unified pipeline and why the sanitiser sits
  where it does, what it lets through, and the type stub that keeps the DOM out of this package.
