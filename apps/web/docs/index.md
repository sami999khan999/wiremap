---
title: "@loadbearing/web"
description: The TanStack Start application. Thin, deletable and framework-shaped — every decision it makes is about the seam between a browser and the server graph, and no business logic lives here.
---

# `@loadbearing/web`

**This app answers one question: how does a browser reach the domain?** Routing, SSR, the oRPC
transport, four server functions and a session snapshot. Everything it renders comes from
`packages/feature`; everything it decides comes from `packages/composition`.

It is deliberately deletable. A second shell — the Tauri desktop app, a mobile client — replaces
this package and nothing beneath it, which is only true because business logic never lands here.

| | |
| --- | --- |
| **Package** | `@loadbearing/web` (private, never published) |
| **Entrypoint** | none — `vite build` produces `.output/`, and nothing imports this app |
| **Depends on** | `@loadbearing/{api-client,content,contracts,feature,permissions,query,ui}` client-side; `@loadbearing/composition` server-side only |
| **Environment** | both halves, separated by the server-only boundary |
| **Setup doc** | [24 · The web app](../../../docs/setup/24-web-app.md) |

```
apps/web/
├── vite.config.ts
├── vitest.config.ts
├── src/
│   ├── env.ts                        → Env               (server-only; one of two process.env readers)
│   ├── endpoint.ts                   → Endpoint          (the two addresses a browser needs)
│   ├── import.ts                     ← the client-safe outside surface
│   ├── router.tsx                    → createAppRouter
│   ├── route-tree.gen.ts             ← generated; never edited
│   ├── route/
│   │   ├── __root.tsx
│   │   ├── -context.ts               ← `-` prefix: not a route
│   │   ├── -guard.ts                 → RouteGuard
│   │   ├── -messages.ts
│   │   ├── -redirect.ts
│   │   ├── -session.ts               → refreshSession, completeSignIn
│   │   ├── (shell)/                  ← anonymous: sign-in, sign-up, recovery, invitation
│   │   ├── (app)/_authenticated/     ← settings, organization
│   │   ├── (dev)/kitchen-sink.tsx
│   │   └── api/{health,auth/$,rpc/$}.ts
│   ├── server/
│   │   ├── import.ts                 ← the server-only outside surface
│   │   ├── container.ts
│   │   ├── cors.ts
│   │   ├── rpc-client.ts
│   │   ├── {session,appearance,invitation}.fn.ts
│   │   └── orpc/                     → base, routers, the error interceptor
│   └── store/
│       ├── session.store.ts          → SessionStore, SessionSnapshot
│       └── appearance.store.ts       → AppearanceStore
└── tests/
    ├── endpoint.spec.ts
    ├── route/redirect.spec.ts
    ├── server/{cors,error.interceptor}.spec.ts
    └── store/{appearance,session}.store.spec.ts
```

---

## What belongs here

Three things, and nothing else:

1. **A route, a layout or a guard.** Anything the router has to know about.
2. **A transport concern** — the oRPC middleware chain, CORS, a server function, the error
   interceptor.
3. **Per-request state that rides the SSR payload** — the session snapshot, the message store, the
   appearance preference.

**What does not belong here.** A rule you could state without mentioning HTTP, a query, a component,
or a permission decision. If a change to this app would have to be repeated in the desktop shell, it
is in the wrong package: it belongs in `feature`, `query` or `application`, and this app should be
calling it.

The test is mechanical. `grep -rn "@loadbearing/composition" src/` must return hits only under
`src/server/`, and no file under `src/route/` may name a use-case.

---

## The two import surfaces

This is the only package in the repository with two `import.ts` files, and the split **is** the
server-only boundary:

| Surface | May name | Read by |
|---|---|---|
| `src/import.ts` | the client-safe packages, React, the router, zod | everything |
| `src/server/import.ts` | `@loadbearing/composition` and what is under it | `src/server/**` only |

A server-only package appearing on the client surface is the leak, visible at one line rather than
after a bundle grep. Three imports are deliberately outside both, each forced by tooling.
See [`reference/import-surfaces.md`](reference/import-surfaces.md).

## Four enforcement surfaces, in order of authority

Removing a permission from a role must hide the affordance **and** return `FORBIDDEN`. One without
the other is either security theatre or a UI full of buttons that error.

1. `Authorizer.assert()` inside the use-case — **the gate**.
2. `principalMiddleware` on the oRPC chain — defence in depth, failing closed.
3. `RouteGuard` in a route's `beforeLoad`.
4. `<Can>` in a component — a UX affordance, never a check.

See [`reference/enforcement-surfaces.md`](reference/enforcement-surfaces.md).

## Four routes unwind the session the same way, and one deliberately does not

Sign-out, organization switch, organization create and invitation accept all end with the same four
steps in the same order — clear the cache, invalidate the session store, re-run the root loader,
then navigate. `refreshSession` in `route/-session.ts` is that sequence. Reversed, one frame renders
the previous tenant's rows under the new tenant's session, which is the sort of thing that gets
noticed in a screenshot rather than in a test.

**Sign-in is the exception and gets `completeSignIn`.** Nothing in the cache belongs to a previous
session, so clearing it throws away the messages the shell has just loaded for the page the reader
is being sent to. Naming the two separately is what stopped the fifth call site from being written
as "the same three steps, minus one" in a comment.

## Reference

- [The two import surfaces](reference/import-surfaces.md) — why the split exists, and the three
  imports that sit outside both.
- [Server functions](reference/server-functions.md) — why a `*.fn.ts` is half client, and what that
  means for what it may import.
- [Enforcement surfaces](reference/enforcement-surfaces.md) — the four checks, their order of
  authority, and why the weakest one is still worth having.
- [`Env` and `Endpoint`](reference/env.md) — the one cross-field rule, why `Endpoint` exists as a
  separate file, and the `.invalid` base URL.
