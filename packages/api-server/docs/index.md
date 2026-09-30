---
title: "@loadbearing/api-server"
description: The router half of the transport — the authed middleware chain, the error interceptor and the stream router — shared by every app that serves procedures.
---

# `@loadbearing/api-server`

**`api-client` is how the browser reaches the server. `api-server` is what answers it**, minus the
HTTP adapter. The adapter is each app's own; everything behind it is here, because more than one
app mounts it: `apps/web` serves every procedure, and the stream process serves the stream.

| | |
| --- | --- |
| **Package** | `@loadbearing/api-server` (private, never published) |
| **Entrypoint** | `src/index.ts` |
| **Depends on** | `application`, `composition`, `contracts`, `errors`, `observability`, `@orpc/server` |
| **Used by** | `apps/web`, through `apps/web/src/server/import.ts` |
| **Environment** | Node only. Server-only in Biome's import ban, like `composition` |

```
packages/api-server/src/
├── index.ts
├── import.ts
└── router/
    ├── base.ts                  the `authed` chain: correlation → errors → principal → shard
    ├── error.interceptor.ts     every failure to the wire envelope, logged once
    ├── rate-limit.policy.ts     the procedures that are limited, and how hard
    ├── stream-revalidation.ts   an open stream asks again every minute
    └── realtime.router.ts       the stream: the user's channel
```

**Why a package and not a folder in `apps/web`.** Apps cannot import each other, and the second app
that serves procedures needs the same chain exactly — the same principal resolution, the same
permission gate that fails closed, the same shard scope carried across every frame of a stream.
A copy would be the subtlest code in the transport, maintained twice. The decision is recorded in
[`docs/opinions/dependencies.md`](../../../docs/opinions/dependencies.md), Tier 3.

**What stays in the apps.** `RPCHandler` from `@orpc/server/fetch` or `/node`, CORS, and the route
that mounts them. Those change when the HTTP framework does; nothing here does.

- [Router](reference/router.md) — the chain's order, why streams are wrapped twice, and why one
  namespace is one process.
