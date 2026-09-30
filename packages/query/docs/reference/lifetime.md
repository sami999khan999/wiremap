---
title: Lifetime
description: Why the query client is a factory, the provider is context, and neither is a module singleton — the same rule the container and the message store follow, for the same reason.
---

# Factories, context, and the singleton that leaks

```ts
export function createQueryClient(options: QueryClientOptions): QueryRuntime
```

A function, not `export const queryClient = new QueryClient(...)`. The difference only shows up in
production, on the second concurrent request.

## The failure, precisely

A module-scope `QueryClient` inside a server bundle is created once per **process** and shared by
every request that process handles. TanStack caches by key, and the keys here are things like
`["rbac", "effective", userId]` — so:

1. User A's request populates `["session"]` and a dozen tenant-scoped keys.
2. User B's request arrives on the same process, hits the same client, and finds them fresh.
3. Nothing refetches, because `staleTime` has not elapsed.

**Under this permission model that is a cross-tenant read, not a caching bug.** No error is logged,
no assertion fires, and the response is a valid render of someone else's data.

It works perfectly in development, where there is one user and one tab. That is what makes it worth a
reference page rather than a comment.

## Three lifetimes, one factory

| Entry point | Instances | Reason |
| --- | --- | --- |
| `apps/web` SSR | one per **request** | The failure above |
| `apps/web` browser | one singleton | One user per browser; the cache is theirs |
| Tauri webview | one singleton | No SSR, so no shared-process concern |

The same definition serves all three, because what differs is *when it is called*, not what it
builds. The browser calls it once at startup; the server calls it per request, in the same place it
builds the per-request `ApiClient`.

## The provider is context for the same reason

```ts
const ApiClientContext = createContext<ApiClient | null>(null);
```

`useApiClient` reads from context rather than importing a module-level client, because the SSR
instance and the browser instance are **different objects with different transports** — one wraps the
in-process router client, the other an HTTP link. A module import cannot be two things at once.

`useApiClient` throws rather than returning `null` when there is no provider. A component rendered
outside the provider is a wiring mistake, and the error naming the provider is a shorter debugging
session than `undefined` propagating into a `queryFn`.

## The same rule, three times in this repository

This is not a React idiom. It is one rule about request-scoped state, and it shows up wherever
per-request data meets a long-lived process:

| Thing | Rule | Where |
| --- | --- | --- |
| `QueryClient` | one per request on the server | here |
| `Container` | one per **process**, and it holds no request state — the `Principal` is an argument to `execute()` | [`composition`](../../../composition/docs/reference/container.md) |
| `MessageStore` | one per request; a module-scope store serves one user's locale to the next | [`content`](../../../content/docs/index.md) |

The container is the interesting contrast. It is *deliberately* a process singleton — because it
holds only things that are the same for every request: a connection pool, a clock, an authorizer.
The moment something per-request goes on it, it inherits the failure above. That is why doc 17 rule 2
exists, and why it reads as the mirror image of this page.

**The test that catches it** is not a unit test. `createQueryClient` returning a fresh instance is
asserted here; a module singleton reintroduced later would still pass that. What catches the
regression is the rule being written down, plus `grep -rn "new QueryClient" packages apps` returning
exactly one hit — inside this factory.

## `staleTime` is the blast radius

The two defaults interact, and it is worth seeing why:

```ts
staleTime: 30_000,
gcTime: 5 * 60_000,
```

`staleTime` is how long a cached answer is served without refetching, so on a leaked singleton it is
also *how long the wrong tenant's data is served*. `gcTime` is how long an unused entry survives in
memory. Neither number is the fix — the factory is — but a shorter `staleTime` narrows nothing about
correctness and only costs round trips, which is why the answer is the lifetime and not the timeout.
