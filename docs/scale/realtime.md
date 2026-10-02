---
title: Realtime
description: Wiremap polls instead of streaming, because Vercel holds no long-lived connection. What was removed, what stayed, and how to bring the live stream back.
---

# Realtime

**Wiremap polls.** The bell refreshes every 60 seconds and whenever a tab comes back into view. A
running scan refreshes every 3 seconds while its page is open. Nothing is pushed.

## Why

The kit pushes updates over a server-sent event stream held by a separate process, `apps/realtime`.
That process needs a long-lived connection per open tab and a Redis subscription behind it. Vercel's
functions end when the response does, so the stream cannot live there, and a second always-on host
would break the free-tier rule ([`docs/infra/free-tier.md`](../infra/free-tier.md)).

## What was removed, and what stayed

| Removed | Stayed |
|---|---|
| The `apps/realtime` process, its boot smoke and its CI build | The `RealtimePublisher` and `RealtimeSubscriber` ports |
| The Vite proxy from `/api/realtime` to it | `RedisRealtimePublisher`, `RedisRealtimeSubscriber` and the replay log |
| `REALTIME_PORT`, `REALTIME_SHUTDOWN_TIMEOUT_MS` | The `realtime.*` contract and `RealtimeRouter` |
| The `realtime.stream.drained` log event | `RealtimeProvider`, which now takes `transport="poll"` |

`REALTIME_DRIVER=none` makes the container publish nothing (`NoopRealtimePublisher`), so no Redis
command is spent on a frame nobody reads.

## Bringing the stream back

When there is a host that can hold connections (a VPS, Fly, or a Cloudflare Durable Object fronting
the same contract):

1. Restore `apps/realtime` from the kit at `ea3e7c4` (`git checkout ea3e7c4 -- apps/realtime`),
   along with its lines in `package.json`, `.github/workflows/ci.yml`, `tooling/scripts/boot-smoke.mjs`
   and the proxy in `apps/web/vite.config.ts`.
2. Add its shard reader back to §29's list in `tooling/scripts/check-architecture.mjs`.
3. Set `REALTIME_DRIVER=redis` in both apps.
4. Mount `RealtimeProvider` with `transport="stream"` (the default) in
   `apps/web/src/route/(app)/_authenticated.tsx`.
