---
title: redis
description: Two instances with opposite durability guarantees, every flag explained, and why one container was the wrong answer.
---

# `redis-cache` and `redis-queue`

The same image twice, configured as opposites. This is the most-questioned pair in the stack and the
one worth understanding before changing anything.

| | `redis-cache` | `redis-queue` |
| --- | --- | --- |
| **Inside the network** | `redis-cache:6379` | `redis-queue:6379` |
| **From the host** | `localhost:26379` | `localhost:26380` |
| **Eviction** | `allkeys-lru` | `noeviction` |
| **Persistence** | none | AOF |
| **Volume** | none | `redisqueuedata` |
| **Holds** | capability cache, session cache | BullMQ jobs |
| **If flushed** | a slow minute | **lost work** |

**Both listen on 6379 inside the network.** They are separate containers, so there is no collision —
only the host mapping differs. `redis-queue:6380` from inside the network is wrong and will refuse.

---

## Why two

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

**The absence of a correct single answer is the tell that it was two concerns wearing one container.**

---

## The flags

```yaml
redis-cache:
  command: ["redis-server", "--save", "", "--maxmemory-policy", "allkeys-lru"]
```

**`--save ""`** disables RDB snapshotting entirely. An empty string is how Redis expresses "no save
points" on the command line; omitting the flag leaves the image's defaults, which do periodic
snapshots to disk. Snapshotting a cache is I/O spent on data that is worthless the moment it is
stale.

**`--maxmemory-policy allkeys-lru`** evicts the least-recently-used key of *any* kind when memory is
tight. The `allkeys` prefix matters: `volatile-lru` only considers keys with a TTL, and a key written
without one would then be immortal and the instance would fill anyway.

```yaml
redis-queue:
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

`RedisConnection` takes both URLs and hands out the right client per job
([15](../../setup/15-infrastructure-package.md)):

```ts
redis.client()           // cacheUrl    — prefixed, for RedisCacheStore
redis.queueClient()      // queueUrl    — maxRetriesPerRequest: null, for BullMQ
redis.realtimeClient()   // realtimeUrl — live frames; the cache client itself when unset
redis.subscriberClient() // realtimeUrl — subscriber mode, opened by the first stream
```

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

> **Anything reached through `CacheStore` is on the instance that evicts** — including Better Auth's
> secondary storage. That is exactly why sessions stay in Postgres and Redis is only a read-through
> in front of them. An evicted session must be a cache miss, never a sign-out.

### A third instance for live frames, when fan-out gets heavy

`REDIS_REALTIME_URL` is optional. Unset, or equal to `REDIS_CACHE_URL`, live frames ride the cache
instance and `realtimeClient()` **is** the cache client — no extra socket. Set it apart once a large
room's fan-out competes with every request's session and permission reads: one message to a 25 000
member room is 25 000 publishes, on the instance a sign-in is waiting on.

Pub/sub keeps nothing, so that instance needs no persistence and no eviction policy. What it does
need is attention to `client-output-buffer-limit pubsub`: a subscriber that falls behind is
**disconnected** at the limit, and every stream on that process then ends and resyncs at once.

---

## Checking it

```bash
C="docker compose -f infra/docker-compose.yml"
$C exec redis-cache redis-cli config get maxmemory-policy   # allkeys-lru
$C exec redis-queue redis-cli config get maxmemory-policy   # noeviction
$C exec redis-queue redis-cli config get appendonly         # yes
$C exec redis-cache redis-cli config get save               # (empty)
```

```bash
# safe by construction — everything on the cache reads through to Postgres
docker compose -f infra/docker-compose.yml exec redis-cache redis-cli flushall
```

The same command against `redis-queue` deletes work. The split is what makes it possible to clear one
without the other, and the habit is worth forming locally where the cost is zero.
