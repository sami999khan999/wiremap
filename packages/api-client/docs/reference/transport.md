---
title: Transport
description: Why ApiClient's constructor is private, what the loopback SSR request actually costs, and why the fetch override reaches globalThis instead of naming Request and Response.
---

# `ApiClient`

```ts
private constructor(private readonly rpc: AppClient) {}

public static overHttp(baseUrl: string, auth: AuthStrategy, streamUrl = baseUrl): ApiClient
public static inProcess(rpc: AppClient): ApiClient
```

**Streams go to `streamUrl`.** The link picks a URL per call from the procedure's first path
segment: `realtime.*` — both streams — goes to `streamUrl`, and everything else to `baseUrl`. The
web app passes `/api/realtime`, which Vite or the reverse proxy sends to the stream process, so the
web app holds no open stream at all. One namespace is one process, with no list to keep in step.

The constructor is private because **a URL is not always the right way to reach the server, and the
one case where it is wrong is the common one.**

## What the loopback SSR request costs

`ApiClient.overHttp("/api/rpc", …)` inside a server-rendered loader resolves to the process it is
already running in. Every call then:

1. serialises the payload,
2. opens a socket to itself,
3. traverses the HTTP stack inbound,
4. deserialises,
5. and does all of it again on the way back.

Two extra event-loop trips and two serialisation round-trips per query, on a request that never
needed to leave the process. A page with six loaders makes six self-requests before rendering a byte,
and they compete with real user requests for the same connection pool — so the cost is worst exactly
when the server is busiest.

`inProcess` takes the router client `apps/web` already has and calls it directly. Same middleware,
same `principalMiddleware`, same `Authorizer.assert()`. **Only the serialisation is skipped.**

> [!IMPORTANT]
> That is a transport optimisation and never an authorization shortcut. `apps/web` passes the real
> `request.headers` into the router context. Dropping them because the code is already on the server
> either breaks auth outright or invites someone to construct a privileged principal by hand — and
> the second one does not fail a test, it fails an audit.

## Both factories return the same type

That is the whole point. `createQueryClient()` picks per environment
([21](../../../../docs/setup/21-query-package.md)):

```ts
transport: ApiClient.overHttp(Env.apiUrl, new CookieAuthStrategy())   // browser
transport: ApiClient.inProcess(createServerRpcClient(request))        // SSR
```

Nothing downstream can tell which it got. On client-side navigation the *same loader* runs in the
browser and uses the HTTP client automatically — provided the client comes from the environment-aware
factory rather than a module-scope singleton. A singleton in an SSR bundle is shared across requests,
which is the same bug as request state on the `Container`
([17](../../../composition/docs/reference/container.md)).

## The `fetch` override, and why it names nothing

```ts
type FetchLike = (input: unknown, init?: Record<string, unknown>) => Promise<never>;

const platformFetch = (): FetchLike => (globalThis as unknown as { fetch: FetchLike }).fetch;
```

The override exists for one reason: `RPCLink` has a `headers` hook but no way to set `credentials`,
and `credentials` is a per-strategy decision. So the request passes straight through with one field
added.

`unknown` in and `never` out is not laziness. Naming `Request` or `Response` in this file would need
`lib.dom`, and this package must typecheck without it. Both values flow through untouched, so neither
has to be named — and `Promise<never>` is assignable to whatever oRPC declares the return to be.

Reaching `fetch` off `globalThis` is the same pattern `Uuid` uses for `crypto` and `JsonLogger` uses
for `console`: the runtime has it, `lib: ["ES2024"]` does not declare it, and a cast at the one line
that touches it beats a lib that declares `document` in a package that must run in Node.

## `raw`, and the accessors that will replace it

```ts
public get raw(): AppClient {
  return this.rpc;
}
```

`AppContract` is `{}` until the first slice lands, so `raw` is all there is. As namespaces arrive they
become two-line getters — `public get task() { return this.rpc.task; }` — and `raw` stops being the
way callers reach the server.

That is worth doing rather than leaving `raw` as the public surface. A getter per namespace gives
`ApiClient` a readable API instead of a pass-through, and it gives a per-namespace concern — a retry
policy for a procedure backed by a flaky third party — somewhere to live without touching call sites.

## What the specs actually pin

`tests/client/api-client.spec.ts` stubs `globalThis.fetch`, captures the outbound request, and then
**rejects** — returning a well-formed RPC response would mean encoding oRPC's wire format in a spec,
which is testing the library rather than this package.

What it asserts is the seam: cookie strategy gives `credentials: "include"` and no `authorization`
header; bearer strategy gives `credentials: "omit"` and `Bearer abc123`. That is
[18](../../../../docs/setup/18-api-client-package.md)'s gate — *"swapping one strategy for the other
requires no other edit anywhere"* — turned into something that fails when it stops being true.
