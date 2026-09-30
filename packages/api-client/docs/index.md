---
title: "@loadbearing/api-client"
description: How to reach the server — the typed oRPC client, the auth-strategy seam, and a transport that lets SSR skip the network entirely. React-free, and it has to stay that way.
---

# `@loadbearing/api-client`

**`api-client` is how to reach the server. [`query`](../../query/docs/index.md) is how to cache what
comes back.** They change for different reasons — this one when the backend changes, `query` when
product behaviour does — which is why they are two packages.

```bash
grep -rnE "@tanstack|from \"react\"" packages/api-client/src
```

Returns nothing, and that is a hard constraint rather than a preference. This package must load in a
plain Node script, an integration test, and any future non-React host — a CLI, a migration script, a
sidecar. **One React import makes all of those impossible.**

| | |
| --- | --- |
| **Package** | `@loadbearing/api-client` (private, never published) |
| **Entrypoint** | `src/index.ts` |
| **Depends on** | `@loadbearing/contracts`, plus `@orpc/client`, `@orpc/contract`, `better-auth` |
| **Used by** | `query`, `feature` (type-only), `apps/web` |
| **Environment** | isomorphic — browser, Tauri webview, Node. **No `ServerOnly.assert()`** |

```
packages/api-client/src/
├── index.ts
├── import.ts                             ← every external symbol. Note what is absent
├── client/
│   ├── index.ts
│   └── api-client.ts                     → ApiClient, AppClient
└── auth/
    ├── index.ts
    ├── auth.client.ts                    → AuthClient, AuthClientConfig
    ├── account.client.ts                 → AccountClient, ActiveSession, LinkedAccount,
    │                                       TwoFactorEnrolment
    ├── organization.client.ts            → OrganizationClient, OrganizationSwitch
    ├── better-auth-error-normalizer.ts   → BetterAuthErrorNormalizer, BetterAuthError
    ├── auth.strategy.ts                  → AuthStrategy, RequestCredentials
    ├── bearer-auth.strategy.ts           → BearerAuthStrategy
    ├── cookie-auth.strategy.ts           → CookieAuthStrategy
    └── token.provider.ts                 → TokenProvider

packages/api-client/tests/
├── auth/
│   ├── auth.client.spec.ts
│   ├── auth.strategy.spec.ts
│   ├── better-auth-error-normalizer.spec.ts
│   └── organization.client.spec.ts
└── client/api-client.spec.ts
```

`auth/` **is the entire difference between a web client and a desktop client.** Everything above it —
`query`, `feature`, every component — is identical either way.

## Two factories, and the one that skips the network

The obvious design, `new ApiClient(baseUrl, auth)`, has a hidden cost during SSR: `"/api/rpc"`
resolves to your own server, so every loader makes a real HTTP request out through the loopback and
back in. Six loaders on a page is six self-requests before a byte renders, competing with real user
traffic for the same connection pool.

So the constructor is private:

| Factory | Used by | Transport |
| --- | --- | --- |
| `ApiClient.overHttp(baseUrl, auth)` | browser, Tauri webview, CLI | `RPCLink` over `fetch` |
| `ApiClient.inProcess(rpc)` | SSR loaders in `apps/web` | the router client, directly |

`createQueryClient()` in [21](../../../docs/setup/21-query-package.md) picks per environment. Both
satisfy the same type, so nothing downstream can tell which it got — and on client-side navigation
the same loader runs in the browser and picks up the HTTP client automatically.

> [!IMPORTANT]
> **In-process is a transport optimisation, never an authorization shortcut.** `apps/web` passes the
> real request headers into the router context. Skipping them because "we are already on the server"
> either breaks auth or tempts someone into constructing a privileged principal directly. Same
> middleware, same `Authorizer.assert()`; only the serialisation is skipped.

## The auth seam

A Tauri webview runs on a `tauri://` origin, so a cookie set by the API is **never** sent with its
requests. That single fact is why `AuthStrategy` exists.

| | `CookieAuthStrategy` | `BearerAuthStrategy` |
| --- | --- | --- |
| `headers()` | `{}` | `{ authorization: "Bearer …" }`, or `{}` when there is no token |
| `credentials` | `include` | **`omit`** |
| Host | browser | Tauri webview, CLI, integration test |

`credentials: "omit"` on the bearer path is not tidiness. A desktop shell that calls a third-party
origin must not hand it a session cookie the API would not have read anyway.

**`TokenProvider` is abstract because *where* the token lives differs by host** — the OS keychain
behind a Tauri `invoke`, a mobile keychain, an in-memory value in a test. All three are
asynchronous, which is why `get()` returns a promise. Two methods, not three: `set(null)` is the
clear path, and [30](../../../docs/setup/30-desktop-app.md) depends on that shape exactly —
`noImplicitOverride` turns a stale `token()`/`store()`/`clear()` triple into a compile error.

See [`docs/reference/auth-strategy.md`](reference/auth-strategy.md) for what the specs actually pin
down at the wire.

## Why the vanilla Better Auth client

`AuthClient` wraps `better-auth/client`, **never `better-auth/react`**. That package's `useSession`
keeps its own cache with its own invalidation rules, which would mean two caching systems in one app:
TanStack Query for everything, and a separate one for the single piece of state that gates all of it.
When they disagree — and they do, on sign-out — the UI shows a signed-in shell wrapped around a run
of `UNAUTHORIZED` responses.

Wrapping the vanilla client here puts session state in the same cache as everything else, through
`SessionStore` in `apps/web`, which rides the SSR payload. One owner, one invalidation story.

**`AuthClient` throws rather than returning `{ data, error }`.** Better Auth's client returns the
pair; the rest of this codebase throws. Normalising at the boundary means a `SignInForm` uses the same
error handling as every other mutation.

## Reference

- [The transport](reference/transport.md) — what crosses the wire, and what a backend swap touches.
- [`AuthStrategy`](reference/auth-strategy.md) — cookie versus bearer, and what the specs pin at the
  wire.
- [The Better Auth boundary](reference/better-auth.md) — why both clients throw, the sign-in that
  succeeds and is not one, and the code-then-status table the normalizer maps with.

## What a backend swap costs

| Scenario | Changes here | Changes anywhere else |
| --- | --- | --- |
| TanStack Start + oRPC (today) | — | — |
| NestJS + oRPC | `RPCLink` → `OpenAPILink` | none |
| NestJS + plain REST | add a REST transport under `client/` | none |
| Tauri desktop | `CookieAuthStrategy` → `BearerAuthStrategy` at one call site | none |
| CLI or script | constructs `ApiClient.overHttp` directly, skips `query` | none |

**When NestJS arrives, SSR loses its in-process shortcut** — the API becomes a separate process, so
loaders make real HTTP calls. Point the server-side client at an internal URL and forward the
incoming request's cookies onto the outbound call. That is a change to one factory, which is only
true because loaders go through `ApiClient` instead of importing the router.

## Picking the transport is a build-time decision, not a runtime one

`apps/web/src/router.tsx` chooses with `createIsomorphicFn`, and the Start plugin removes the branch
that does not apply along with its imports — which is what keeps `createServerRpcClient`, and the
whole container graph behind it, out of the client bundle. The bundle assertion in
[26](../../../docs/setup/26-hygiene-and-ci.md) is what proves that rather than assuming it.

> [!IMPORTANT]
> **`overHttp` refuses a relative base outside a browser.** `Endpoint.rpc` is `/api/rpc`, which is
> correct in a browser and unresolvable under Node — `fetch` has no document to resolve against, so
> the first call throws `TypeError: Invalid URL` from inside a route loader, several frames from the
> line that chose the transport. The guard turns that into an `InternalError` at construction whose
> `cause` names `ApiClient.inProcess`.
>
> The sentence rides on `cause` rather than `message` because the code **is** the message here
> ([`errors`](../../errors/docs/index.md)): the envelope stays wordless and the diagnostic reaches
> the logger.

**Two namespace accessors, and the rest go through `raw`.** `role` and `member` have a `get` on
`ApiClient`; a slice adds two lines — `public get task() { return this.rpc.task; }` — which is what
keeps the public surface readable rather than a pass-through, and gives a per-namespace concern (a
retry policy for a flaky procedure) somewhere to live later.
