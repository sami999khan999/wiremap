---
title: "@loadbearing/query"
description: The single TanStack owner — cache keys, the client factory, the provider, and one mutation hook that makes invalidation declarative. Session state lives in the same cache as everything else.
---

# `@loadbearing/query`

**`api-client` is how to reach the server. `query` is how to cache what comes back.** They change for
different reasons — the first when the backend changes, the second when product behaviour does.

**One package in the repository imports `@tanstack/*`. This is it.**

```bash
grep -rn "@tanstack" packages/*/src | grep -v "packages/query"
```

Returns nothing. Scoped to `src/` because `import.ts` governs the shipped surface, not `tests/` — a
spec imports its harness directly, the same way it imports `vitest`, and `feature`'s harness mounts a
real `QueryClientProvider` to build the environment a component runs in.

And the mirror of that rule matters as much:

```bash
grep -rn "@tanstack/react-router" packages/query/src
```

Also nothing. Routing stays in `apps/web`, which is what lets the Tauri shell reuse everything above
this package.

| | |
| --- | --- |
| **Package** | `@loadbearing/query` (private, never published) |
| **Entrypoint** | `src/index.ts` — opens with `"use client"` |
| **Depends on** | `@loadbearing/api-client`, `@loadbearing/errors`, `@tanstack/react-query` |
| **Peers** | `react`, `react-dom` — never dependencies |
| **Used by** | `feature`, `apps/web`. **Not** `apps/worker` — it calls use-cases in-process |

```
packages/query/src/
├── index.ts                        ← "use client" on line 1
├── import.ts                       ← every external symbol. The router package is not on it
├── key/
│   ├── index.ts
│   └── query-key.ts                → QueryKeys
├── runtime/
│   ├── index.ts
│   ├── query-client.ts             → createQueryClient, QueryClientOptions, QueryRuntime
│   ├── api-client.context.tsx      → ApiClientProvider, useApiClient
│   ├── use-app-mutation.ts         → useAppMutation, AppMutationOptions
│   └── use-app-query.ts            → useAppQuery
├── session/                        ── one subject folder per slice
│   ├── index.ts
│   ├── session.queries.ts          → SessionQueries
│   └── session.mutations.ts        → SessionMutations
├── account/
│   ├── index.ts
│   ├── account.queries.ts          → AccountQueries
│   └── account.mutations.ts        → AccountMutations
├── member/
│   ├── index.ts
│   ├── member.queries.ts           → MemberQueries
│   └── member.mutations.ts         → MemberMutations
├── organization/
│   ├── index.ts
│   └── organization.mutations.ts   → OrganizationMutations
├── platform/
│   ├── index.ts
│   └── platform.queries.ts        → PlatformQueries
└── rbac/
    ├── index.ts
    ├── role.queries.ts             → RoleQueries
    └── role.mutations.ts           → RoleMutations
```

Two role folders and one subject folder, the same split
[`contracts`](../../contracts/docs/index.md) has: `key/` and `runtime/` because there is exactly one
of each, `session/` because there is one per slice.

> [!IMPORTANT]
> **The barrel opens with `"use client"`, and only three packages may.** `ui`, `query` and `feature`
> are React components and hooks end to end, so a barrel-level directive is accurate. Next's App
> Router treats every module as a Server Component until told otherwise; without the directive a Next
> page importing from here fails the build. A Vite SPA and TanStack Start ignore it.
>
> **Verified rather than assumed:** `head -1 dist/index.js` is `"use client";`. esbuild has
> historically dropped top-level directives, and a bundler upgrade that reintroduced that would break
> Next silently, at the consumer, with an error naming *their* file.

## `createQueryClient` is a factory, and that is a correctness boundary

| Entry point | Lifetime | Why |
| --- | --- | --- |
| `apps/web` SSR | **one per request** | A shared instance serves user A's cached data to user B. Under this permission model that is a cross-tenant leak, not a caching bug |
| `apps/web` browser | one singleton | Normal client behaviour |
| Tauri webview | one singleton | No SSR, so no per-request concern |

A module-scope `new QueryClient()` inside a server bundle is shared across every concurrent request.
**It works perfectly in development, where there is one user.** The reasoning, and the two other
places this repository makes the same call, are in
[`docs/reference/lifetime.md`](reference/lifetime.md).

`createQueryClient` takes a **constructed** `ApiClient`, never a base URL — that is what lets the
server hand it an in-process transport and the browser an HTTP one, with nothing downstream
differing:

```ts
// apps/web/src/router.tsx — the plugin removes the branch that does not apply,
// along with its imports, which is what keeps the container out of the browser.
const transport = createIsomorphicFn()
  .client(() => ApiClient.overHttp(Endpoint.rpc, new CookieAuthStrategy()))
  .server(() => ApiClient.inProcess(createServerRpcClient(getRequest())));
```

**Both sides are load-bearing, and the server one is not an optimisation.** `Endpoint.rpc` is a
relative path: correct in a browser, unresolvable under Node. A loader calling `ensureQueryData`
during SSR through the HTTP transport fails outright rather than being slow, which is why
`ApiClient.overHttp` now refuses a relative base outside a browser
([`api-client`](../../api-client/docs/index.md)).

**`createQueryClient` is an exported function**, which the repo's OOP rule would normally reject —
`packages/query` is deliberately not in that ESLint block. It is a factory in the React idiom, and
wrapping it in a class to satisfy a lint rule would be cargo cult.

## Two defaults that are decisions, not tuning

**`retry` reads the error catalog.** Retryability is a fact about the code, declared once in
[`errors`](../../errors/docs/index.md) and consulted here — so a `FORBIDDEN` is never retried, and a
`RATE_LIMITED` or `UNAVAILABLE` is, at most twice. Retrying a permission failure with backoff turns an
instant *"you cannot do that"* into a three-second wait for the same answer, and triples the load
coming from a client stuck in a bad state.

An unknown throw normalises to `INTERNAL` first, so a library error that is not an `AppError` still
gets an answer from the catalog rather than a default.

**`refetchOnWindowFocus: false`.** The default suits a dashboard someone leaves open all day. Here
every refetch is an authenticated round trip carrying a capability resolution, so freshness is opt-in
per query.

## Keys are never written at a call site

```ts
QueryKeys.rbac.effective("u1")   // ["rbac", "effective", "u1"]
```

**Every key mirrors its procedure path, with parameters last.** `contract.task.list` becomes
`["task", "list", params]`. Given a procedure you can write its key without looking anything up —
the same derivability the file-naming rules have.

**`all()` exists on every namespace**, and TanStack matches by prefix, so one call catches every list
and detail below it. Centralising the keys is what makes invalidation trustworthy: when task
reactivation starts also invalidating capacity and KPI panels, you edit one method instead of
grepping for `invalidateQueries`.

**Parameters go in an object, not spread positionally.** `["task", "list", { goalId, status }]`
rather than `["task", "list", goalId, status]` — adding a filter later then does not shift every key
and invalidate the whole namespace on deploy.

## `useAppQuery` exists so that grep can keep returning nothing

```ts
export function useAppQuery<TQueryFnData, TError, TData, TQueryKey extends QueryKey>(
  options: UseQueryOptions<TQueryFnData, TError, TData, TQueryKey>,
): UseQueryResult<TData, TError> {
  return useQuery(options);
}
```

A pass-through, and unlike `useAppMutation` it adds nothing — it earns its place by **existing**.
[`feature`](../../feature/docs/index.md) reads through it, so the first feature slice does not have
to name the cache library and the one-package invariant survives contact with a real screen.

**There must be nothing else in this function.** All four generics are inferred from the single
argument, so `useAppQuery(TaskQueries.list(client, params))` types its `data` exactly as `useQuery`
would. A defaulted parameter — a retry policy, a `staleTime`, an options merge — moves the inference
site and every call site quietly becomes `unknown`. Per-query defaults belong in the `queryOptions`
factory; global ones belong in `createQueryClient`. A type-level spec pins both directions.

## Invalidation is declared

```ts
useAppMutation({ mutationFn: …, invalidates: [QueryKeys.task.all(), QueryKeys.rbac.all()] })
```

A mutation says *what it affects*; the hook does the invalidating. So "what does reactivating a task
affect" has one answer in one place, and adding a panel that depends on task state is a one-line
edit. Invalidations run before the caller's `onSuccess`, so a caller that navigates on success does
not race the refetch of the screen it is leaving.

## Session lives in this cache, not a second one

`SessionQueries.current(auth)` returns `queryOptions` keyed `["session"]`. That is the whole reason
[18](../../api-client/docs/index.md) wraps Better Auth's **vanilla** client: `better-auth/react`'s
`useSession` keeps its own cache with its own invalidation rules, and when the two disagree — on
sign-out, reliably — the UI shows a signed-in shell wrapped around a run of `UNAUTHORIZED` responses.

**Sign-out clears the entire cache, and that happens at the call site.**
`SessionMutations.useSignOut` takes an `onDone` callback rather than doing it:

```ts
const signOut = SessionMutations.useSignOut(auth, () => {
  queryClient.clear();
  navigate({ to: "/sign-in" });
});
```

Invalidating only `["session"]` leaves every other query in memory, and the next person to sign in on
that machine sees a flash of the previous user's data before the refetch lands. `clear()` belongs at
the call site because it is a lifecycle decision — the desktop app may want to keep an offline cache
across sign-out.

**A class of static hook factories is fine.** The hook rules apply to the call site, and
`SessionMutations.useSignIn(auth)` is called unconditionally at the top of a component, which is all
React requires.

## What a backend swap costs here

Keys and options never name a transport, so all of it is `ApiClient`-internal.

| Scenario | Changes in this package |
| --- | --- |
| TanStack Start + oRPC (today) | — |
| NestJS + oRPC | nothing — `ApiClient` swaps its link |
| NestJS + plain REST | nothing — `ApiClient` gets a REST transport |
| Tauri desktop | imports it unchanged |
| `apps/worker`, a CLI | does not import it at all |

**SSR router integration stays in `apps/web`.** `routerWithQueryClient` needs the router package this
one is forbidden to import, so `query` exports the factory and the app wires it up. That asymmetry is
deliberate: routing is the one thing the desktop shell replaces.

## Reference

- [Client lifetime](reference/lifetime.md) — why `createQueryClient` is a factory, and what one
  module-scope instance costs under this permission model.
- [Mutations and invalidation](reference/mutations.md) — invalidate-before-`onSuccess`, the three
  states of `invalidates`, and why sign-out and switch declare none.
- [Realtime](reference/realtime.md) — one stream per tab, a total routing table, and why a
  frame invalidates rather than patches.

## Every `rbac` key now has a caller

`roles(params)` is read by `RoleQueries.list` and written through by all five of `RoleMutations`;
`effective(userId)` is read by `EffectivePermissionsInspector` when it is inspecting someone other
than the viewer. Doc 21's `QueryKeys.task` stays illustrative: there is no task contract to mirror.

**`RoleMutations.useGrant` and `useRevoke` invalidate `QueryKeys.member.all()` as well as
`rbac.all()`.** A grant changes what the effective-permissions inspector answers for every member
holding that role, and that key hangs off the member namespace.
