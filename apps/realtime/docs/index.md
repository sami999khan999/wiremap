---
title: "@loadbearing/realtime"
description: The stream process. It holds every open browser stream and nothing else, so a thousand open tabs or a reconnect wave after a deploy never slows the web app's pages.
---

# `@loadbearing/realtime`

**This app answers one question: who holds the open line to every browser tab?** Not the web app.
Every tab keeps one or two server-sent-event streams open for as long as it is open; held in the
process that also renders pages, a busy hour or a deploy's reconnect wave competes with every click.
Here, it competes with nothing.

It holds no business logic, and no router of its own. The two streams — `realtime.stream` for the
user's channel, `realtime.conversation` for one room — come from `@loadbearing/api-server`, the same
code and the same `authed` chain the web app mounts. What is this app's own is the HTTP listener,
the probe and the shutdown.

```
apps/realtime/src/
├── main.ts                       Env → Container → StreamListener → RealtimeBootstrap
├── env.ts                        the process's one `process.env` reader
├── import.ts
├── server/
│   └── stream-listener.ts        node:http, `/api/realtime/*` → the oRPC handler, `/healthz`
└── bootstrap/
    └── realtime-bootstrap.ts     start, and a stop that hands every stream on
```

## How a frame reaches a tab

The worker and the web app publish to Redis — a new message, a notification, a typing signal. This
process subscribes, once per channel with a reader, and writes each frame down the streams on it.
Nothing here writes to Postgres, and the only reads are the principal and a room's membership, once
per stream opened. Its pool is five connections for that reason.

## How the browser reaches it

At the web app's own origin, under `/api/realtime`. `ApiClient.overHttp` sends every `realtime.*`
procedure there and everything else to `/api/rpc`; Vite proxies the path to `REALTIME_PORT` in
development, and the reverse proxy does in production. Same origin is what lets the session cookie
ride along with no CORS and no second domain — the cookie is `SameSite=Lax` and host-scoped.

## Reference

- [Env](reference/env.md) — what it needs, and the one setting that must match the web app's.
- [Shutdown](reference/shutdown.md) — why a stop ends streams cleanly and spread out.
