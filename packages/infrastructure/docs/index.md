---
title: "@loadbearing/infrastructure"
description: Every concrete adapter the system owns, behind a port and confined to one package — Postgres and its schema, Redis, S3, BullMQ and OpenAI.
---

# `@loadbearing/infrastructure`

The package that owns `drizzle-orm`, `pg`, `ioredis`, `@aws-sdk/*` and `bullmq`, so nothing else has
to. Each class implements a port from [`@loadbearing/application`](../../application/docs/index.md),
and the `Container` decides which one to build.

```bash
grep -rn "drizzle-orm\|ioredis\|@aws-sdk\|bullmq\|from \"pg\"" packages --include=*.ts   | grep -v "packages/infrastructure"
```

Returns nothing. Every one of them appears in exactly one package, which is the whole claim.

**A separate database package used to sit beside this one, and was folded in.** The two were siblings with no edge
between them, and the split put one seam in two places — `PgAnalyticsReader` on the `db` side,
`ClickHouseAnalyticsReader` on this one. Merging in this direction rather than the other keeps the
name honest: an S3 client in a package called `db` would be a lie, but Postgres genuinely is
infrastructure. Both analytics adapters now sit here, one folder apart, which is what that merge was
for.

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
├── smoke.ts                               ← the wiring check, run against live containers
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
    ├── clickhouse/ clickhouse.connection.ts          → ClickHouseConnection
    │               clickhouse-analytics.reader.ts    → ClickHouseAnalyticsReader
    │               clickhouse-analytics.projector.ts → ClickHouseAnalyticsProjector
    ├── loki/      loki-log.reader.ts       → LokiLogReader
    ├── redis/     redis.connection.ts      → RedisConnection, RedisConfig
    │              redis-cache.store.ts     → RedisCacheStore
    ├── s3/        s3-storage.gateway.ts    → S3StorageGateway, S3Config
    │              storage-key.ts           → StorageKey
    ├── bullmq/    bullmq-queue.publisher.ts → BullMqQueuePublisher
    │              queue-name.ts            → QueueName
    ├── smtp/      smtp-email.sender.ts     → SmtpEmailSender
    ├── gemini/    gemini-embedding.provider.ts → GeminiEmbeddingProvider
    └── openai/    openai-embedding.provider.ts → OpenAiEmbeddingProvider
```

**The four runnable scripts sit above `src/`.** A script inside a folder makes that folder's barrel
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
not a subject. The second is what happens when a port gets a second implementation. `pg/analytics/`
beside `clickhouse/` reads as two different things; `pg/repository/pg-analytics.reader.ts` beside
`clickhouse/clickhouse-analytics.reader.ts` reads as what it is — two implementations of one port,
one per store, each named after the store it speaks to. **The technology is the axis this package
sorts on, and naming the subject twice broke that.**

`smoke/` is the only folder that is not a system: it spans every store at once. And `pg/schema/` is
the one place the subject rule bends — drizzle-kit needs a single barrel naming every table, so the
tables sit together rather than beside the repositories that read them.

**A folder here means the seam is implemented, not that the container is started.** `clickhouse/` and
`loki/` are adapters for services behind an opt-in compose profile, and `Container` builds neither
unless its configuration block is present — see [the swap points](#the-swap-points-and-what-makes-them-real).

## What belongs here and what only looks like it does

| Store | Adapter here? | Why |
| --- | --- | --- |
| Redis | **yes** | `CacheStore`, and the connection BullMQ needs |
| S3 / MinIO | **yes** | `StorageGateway` |
| BullMQ | **yes** | `QueuePublisher`. Consumers live in `apps/worker` |
| OpenAI | **yes** | `EmbeddingProvider` |
| Postgres | **yes** | `drizzle-orm` + `pg` behind seven ports, plus the schema and migrations |
| ClickHouse | **yes** | `AnalyticsReader` *and* `AnalyticsProjector`, same shape as the rest |
| Loki | **yes, read side only** | `LogReader`. Nothing here writes to it |
| Alloy | **nowhere** | A separate process that tails stdout. No client, no port, nothing to import |

**The last two rows are the ones worth understanding, and they are two different answers.**

`JsonLogger` writes structured JSON to stdout and has never heard of Loki; Alloy tails it. That
asymmetry is deliberate and it is what keeps swapping the log platform a config change — the write
path has no seam because it has no dependency. `LokiLogReader` exists for the other direction:
reading diagnostics back, for the operator surface that knows what an organization is, which is the
one thing a generic log console cannot know. One file, one API, replaced wholesale if the platform
changes.

**ClickHouse has two adapters, not one, and the split is the guard.** `ClickHouseAnalyticsReader`
answers dashboard questions and is reachable from a request path. `ClickHouseAnalyticsProjector`
writes, and is reachable only from the worker. A single class with both would put `project()` on the
object a dashboard query holds — and "nothing writes here except the consumer" is what makes the
store rebuildable rather than authoritative.

Neither is built unless `analytics.clickhouse` is configured. Both are exercised by
[the smoke check](#the-smoke-check).

## The swap points, and what makes them real

Two ports have, or will have, more than one implementation. Each is chosen by a `driver` field on
`ContainerConfig` rather than by a `new` in the constructor — so adopting a store is an environment
variable and one `case`, never a change to a use-case, a repository, or a test.

| Port | `driver` | Today | Next | Trigger |
| --- | --- | --- | --- | --- |
| `VectorStore` | `VECTOR_DRIVER` | `pgvector` | a dedicated vector database | pgvector recall or latency degrades |
| `LogReader` | `LOKI_URL` set or not | Loki | anything with a range-query API | search latency during a real incident |

There was a third. `AnalyticsReader` had a `postgres` and a `clickhouse` implementation behind
`ANALYTICS_DRIVER`, and **nothing ever read through either** — so the port, both adapters and the
flag were deleted rather than kept warm. See
[12](../../../docs/setup/12-application-package.md) and
[Simplicity](../../../docs/opinions/simplicity.md).

**The `driver` field is what stops "swap the implementation" from being a claim.** A seam with exactly
one implementation is untested by construction. A seam with a discriminated config is exercised the
first time somebody flips the value — and `Container.buildVectorStore` has an exhaustive `switch`, so
a driver added to the union and not to the switch is a build error.

**Adopting ClickHouse is still deliberately two steps.** Setting `CLICKHOUSE_URL` builds the
projector and starts the worker's projection and reconciliation. Nothing reads the store, so the
second step is *writing* the reader a dashboard needs — against a store that has been filling and
reconciling for days. The gap used to be spelled `ANALYTICS_DRIVER`; it is now the absence of a
reader, which cannot be flipped by accident.

Setting `CLICKHOUSE_URL` also makes `CLICKHOUSE_DATABASE` and `CLICKHOUSE_USER` required: both
default to ClickHouse's own `default` and the compose container is `ratchet`, so the defaults cannot
reach the only ClickHouse this kit ships.

**The two scripts above `src/` enforce it themselves**, because neither loads an `env.ts`:
`clickhouse-migrate.ts` and `vitest.smoke.config.ts` throw on an absent name rather than guessing
one. They used to guess three different pairs between them, and the one that reached a live
container did so because ClickHouse ships a `default` user with no password.

**What makes the vector swap cheap is not the switch.** It is that `VectorStore.search()` takes the
resolved goal scope as a parameter. A remote store holds no `CapabilitySet` and can join back to
nothing, so the permission filter had to run on the input set from the first day or the port would
have been unswappable at any price. Same shape, same reasoning, in `AnalyticsReader.goalRiskScores()`.

## Two Redis instances, one class

`RedisConnection` takes two URLs and hands out two clients, and that is a correctness boundary rather
than tuning.

| | `client()` | `queueClient()` |
| --- | --- | --- |
| Instance | cache — `allkeys-lru` | queue — `noeviction` + AOF |
| Key prefix | `ratchet:` | **none** — BullMQ manages its own keys |
| `maxRetriesPerRequest` | default | **`null`**, or blocking commands die |
| Losing a key | a slow minute | **work that never happens** |

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
[`Container.healthy()`](../../composition/docs/reference/container.md) check both instances without
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

Not a unit test — these are adapters, and testing an adapter against a fake tests the fake. It
round-trips the cache, prunes it and reads back, round-trips an object through S3 with a checksum,
presigns a URL, deletes and confirms absence, then publishes a job. Against the running containers,
with no errors.

**The two opt-in stores are checked when they are configured and skipped with a line when they are
not.** A smoke run against a stack that does not include them should say so and pass, rather than
fail on a service nobody started.

- **ClickHouse** — inserts the same probe row **twice** and counts it back with `FINAL`, expecting
  `1`. That is not a formality: the projection consumer's idempotency rests entirely on
  `ReplacingMergeTree` collapsing a redelivered batch, and an `ENGINE = MergeTree` typo in the init
  script would be invisible until a redelivery doubled a quarter's numbers.
- **Loki** — pings `/ready` and runs a real `query_range` over the last hour, printing what came
  back. It deliberately does *not* assert on a particular line: that would make the check depend on
  something having been logged recently, which is a flaky test rather than a wiring check. That the
  query returns and parses is the claim.

It reads `.env` from the repository root explicitly rather than through a bare `dotenv/config`
import. Under a pnpm filter the process cwd is this package, so the bare form found nothing and every
variable came back undefined — which looks exactly like an unconfigured stack.

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
- [Cold storage](reference/cold-storage.md) — the tenant-month as the unit, the `cold/` prefix,
  `partition_archive` as the index a read starts from, and the restore that proves the difference.
- [The bucket's lifecycle policy](reference/storage-policy.md) — why a second gateway, why "no
  configuration" is an error code, and why the app owns the whole configuration rather than a rule.
- [ClickHouse](https://github.com/prodicle/loadbearing_tanstack_start_kit/blob/3fafa78c2f42d2d718236d7666429b858199118a/packages/infrastructure/docs/reference/clickhouse.md) — no client library, two adapters, and the order it is
  adopted in.
- [Loki](https://github.com/prodicle/loadbearing_tanstack_start_kit/blob/3fafa78c2f42d2d718236d7666429b858199118a/packages/infrastructure/docs/reference/loki.md) — why only a reader exists, and the query shapes the port refuses to
  offer.
- [Realtime](reference/realtime.md) — one subscriber connection per process, ref-counted channels,
  and why the overflow is a `resync`.
- [Fan-out](reference/fan-out.md) — the three §6 paths measured against the running stack, which of
  the three costs nineteen of the twenty-four seconds, and what a `users` delete does to a
  partitioned table.
- [The doc renderer](reference/doc-renderer.md) — the unified pipeline and why the sanitiser sits
  where it does, what it lets through, and the type stub that keeps the DOM out of this package.
