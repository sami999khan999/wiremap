---
title: Split Redis
description: Moving from one Redis to separate cache and queue instances — a config-only change, because the code already reads two URLs.
---

# Split Redis

**The limit.** Lite runs one Redis for three jobs: the cache (sessions, capabilities), the BullMQ job
queue, and realtime pub/sub. They share memory. Because a lost job is work that never happens, the
shared instance runs `maxmemory-policy noeviction`, so a full Redis refuses writes rather than
dropping jobs. As the cache grows, it starts crowding the queue.

**When.** Redis memory climbs toward its limit, or cache traffic slows queue work.

**The fix: config only.** The code already reads `REDIS_CACHE_URL`, `REDIS_QUEUE_URL` and
`REDIS_REALTIME_URL` separately.

1. Add a second Redis to compose. The big kit's `upstream:infra/docker-compose.yml` defines both:
   - **queue**: `noeviction` with `--appendonly yes`, so jobs survive a restart
   - **cache**: `allkeys-lru` with a `maxmemory` cap (`REDIS_CACHE_MAXMEMORY`), so it evicts
     instead of refusing
2. Point `REDIS_QUEUE_URL` at the queue instance and `REDIS_CACHE_URL` at the cache instance.
   `REDIS_REALTIME_URL` can stay on the cache instance.
3. Add `REDIS_CACHE_PORT`, `REDIS_QUEUE_PORT` and `REDIS_CACHE_MAXMEMORY` to `.env.example`.

**No code changes.** If one is needed, some code read one URL for another's job — that is a bug to
fix first.

> [!WARNING]
> Switch the queue instance over while the worker is stopped, or jobs waiting in the old instance
> are stranded there. Drain the queue first.
