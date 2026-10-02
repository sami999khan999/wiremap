---
title: redis
description: One instance for the cache, the queue and realtime — durable, never evicts — every flag explained, and why the cache and the queue keep separate URLs.
---

# `redis`

One container holds three jobs: the cache, BullMQ's queue and live frames. It is configured for the
job that cannot lose data, the queue.

| | `redis` |
| --- | --- |
| **Inside the network** | `redis:6379` |
| **From the host** | `localhost:46379` (`REDIS_PORT`) |
| **Eviction** | `noeviction` |
| **Persistence** | AOF |
| **Volume** | `redisdata` |
| **Holds** | capability cache, session cache, BullMQ jobs, pub/sub frames |
| **If flushed** | **lost work** — the queue goes with the cache |

`REDIS_CACHE_URL` and `REDIS_QUEUE_URL` both point at it.

---

## Why one, and why two URLs

Redis does three jobs here and they are not equally disposable.

**Cache and session storage are cache-aside.** `CapabilityCache` reads through to
`PgCapabilityRepository` on a miss; Better Auth's secondary storage reads through to the Postgres
`session` table. Losing either costs latency, not data.

**A BullMQ job is derived from nothing.** It is work somebody asked for that has not happened yet.
There is no table to rebuild it from, which is why the [derived-store
test](../../opinions/data-and-scale.md) puts it in a different category from everything else
on this page.

One instance forces one eviction policy onto both:

- `allkeys-lru` — memory pressure silently deletes queued jobs. Work vanishes with no error.
- `noeviction` — the queue is safe, and a full cache starts returning errors on a path that should
  degrade gracefully.

**Lite picks `noeviction`, and the cache pays for it.** Every cache key carries a TTL, so stale
entries expire on their own. A full instance is still an error rather than an eviction.

**The two URLs stay separate anyway.** The code already dials the cache and the queue by different
names. Splitting them onto two instances is two `.env` lines and a compose block —
[split-redis](../../scale/split-redis.md). Do it once the cache wants `allkeys-lru`, or once
flushing the cache without flushing the queue matters.

---

## The flags

```yaml
redis:
  command: ["redis-server", "--appendonly", "yes", "--maxmemory-policy", "noeviction"]
```

**`--appendonly yes`** turns on the append-only file — every write is journaled, so a crash loses at
most the last fsync window rather than everything since the last snapshot. This is the flag that
makes the volume meaningful.

**`--maxmemory-policy noeviction`** makes Redis return an error when memory is exhausted instead of
deleting something. Loud and recoverable beats silent and lossy: a failed `enqueue` surfaces as a
failed request, where a silently evicted job surfaces as a customer asking why nothing happened.

**That is why both job sets are capped.** A completed job is kept an hour and at most a thousand
per queue; a failed one a week and at most ten thousand. The failed set is the dead letter —
`pnpm queue:replay <queue>` puts its jobs back — and the cap is what stops a day-long failure storm
filling a `noeviction` instance, which would then refuse every enqueue.

> **AOF covers a crash. It does not cover `FLUSHALL`.** That is why the queue also wants a nightly
> sweep that re-enqueues unprocessed work, reconciling against Postgres rather than against BullMQ's
> own job records — which age out after an hour ([15](../../setup/15-infrastructure-package.md)).

---

## How the application picks one

`RedisConnection` takes the URLs and hands out the right client per job
([15](../../setup/15-infrastructure-package.md)):

```ts
redis.client()           // cacheUrl    — prefixed, for RedisCacheStore
redis.queueClient()      // queueUrl    — maxRetriesPerRequest: null, for BullMQ
redis.realtimeClient()   // realtimeUrl — live frames; the cache client itself when unset
redis.subscriberClient() // realtimeUrl — subscriber mode, opened by the first stream
```

Locally every URL names the one instance, so every client dials `localhost:46379`.

**One class taking two URLs rather than two classes**, because which connection a consumer gets
should be a property of what it is doing rather than a wiring decision. Passing two bare `Redis`
instances into `Container` puts that choice at a call site where both arguments have the same type
and swapping them compiles.

Two settings are not tuning:

**`maxRetriesPerRequest: null` on the queue client.** BullMQ's blocking commands sit open
indefinitely and ioredis's default retry limit kills them. The symptom is workers that stop consuming
after a few minutes with no error.

**A key prefix on the cache client and none on the queue client.** ioredis prepends the prefix
transparently, which is what you want for cache keys and what breaks BullMQ, whose key structure it
manages itself.

> **Sessions stay in Postgres, and Redis is only a read-through in front of them.** Lite's Redis
> never evicts, but a TTL expires a cached session, and a split Redis would evict. Either way a
> missing session must be a cache miss, never a sign-out.

### A separate instance for live frames, when fan-out gets heavy

`REDIS_REALTIME_URL` is optional. Unset, or equal to `REDIS_CACHE_URL`, live frames ride the cache
instance and `realtimeClient()` **is** the cache client — no extra socket. Set it apart once fan-out
competes with every request's session and permission reads. A wide fan-out is many publishes, on
the instance a sign-in is waiting on.

Pub/sub keeps nothing, so that instance needs no persistence and no eviction policy. What it does
need is attention to `client-output-buffer-limit pubsub`: a subscriber that falls behind is
**disconnected** at the limit, and every stream on that process then ends and resyncs at once.

---

## Checking it

```bash
C="docker compose -f infra/docker-compose.yml"
$C exec redis redis-cli config get maxmemory-policy   # noeviction
$C exec redis redis-cli config get appendonly         # yes
```

**Do not `flushall` this instance with work pending.** The cache and the queue share it, so a flush
deletes queued jobs too. Locally that costs nothing. Clearing only the cache needs the split —
[split-redis](../../scale/split-redis.md).
