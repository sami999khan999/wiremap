---
title: Env and Endpoint
description: Why the schema parses eagerly, the two cross-field rules that earn their exception, why Endpoint is a separate file, and why the auth base URL ends in .invalid.
---

# `Env` and `Endpoint`

## `Env` is server-only, and the marker is what enforces it

`env.ts` opens with Start's server-only marker. Its import-protection plugin fails the build when a
module carrying it is reachable from the client graph — **the one guarantee a naming convention
cannot give.** Before it was there, `Env` shipped in the browser bundle as `Schema.parse({})` and
threw on `DATABASE_URL` before the first render.

That marker is a side-effect import, which cannot be re-exported, which is why this file keeps its
own imports rather than reading `~/import.ts`.

It is one of exactly two `process.env` readers in the repository; the other is
`apps/worker/src/env.ts`. Everything else receives configuration.

## Parsed at module load, not on first access

A missing `AUTH_SECRET` should crash the process at boot with a field path, not produce a 500 on the
first sign-in an hour later.

## The two cross-field rules

`bootstrap` with no `BOOTSTRAP_ORGANIZATION_SLUG` is a mode that **silently enrols nobody**:
every sign-up succeeds, every first sign-in is refused, and nothing in either log says why. Failing
at boot with a field path is the whole reason this file parses eagerly, and it is why the schema
carries a refinement at all.

There is deliberately no default for the slug. Unset means no enrolment, which is the production
posture.

**`CLICKHOUSE_URL` with the credential defaults left alone** is the second, and it is the same shape
of failure one layer down. The compose container is `ratchet/ratchet`; the defaults below are
ClickHouse's own `default/default`, which cannot authenticate against it. Without the rule the
projection fails on its first run with a vendor auth error, five minutes after boot, in the worker's
log rather than the one someone is watching.

## Values whose absence is the decision

| Variable | Absent means |
|---|---|
| `GOOGLE_CLIENT_ID` / `_SECRET` | Google sign-in is off. A half-filled pair would be rejected at Google's consent screen, which no log line here can explain — so the container builds a provider only when both are present |
| `CLICKHOUSE_URL` | ClickHouse stays stopped. Present, the projection runs and the reconciliation reports — and nothing reads the store back, because there is no analytics reader; see [12](../../../../docs/setup/12-application-package.md). Setting it makes `CLICKHOUSE_DATABASE` and `CLICKHOUSE_USER` required |
| `LOKI_URL` | No `LogReader`. Logs are still written to stdout and still shipped by Alloy; reading them is `docker compose logs`, which stays the break-glass path regardless |

The ClickHouse credentials default to ClickHouse's own out-of-the-box database and user. A default
naming the project would be a credential baked into shipped code, and would keep pointing at the old
name after a rename — which is why the cross-field rule above refuses those defaults when
`CLICKHOUSE_URL` is set, rather than the defaults being changed to match compose.

## Values with a cap rather than a default

`AUTH_COOKIE_CACHE_MAX_AGE_SECONDS` is capped in the schema, not by convention. A deploy that raises
it "to improve cache hit rate" fails at boot instead of quietly widening the gap between removing
access and access stopping. See
[`auth/docs/reference/capability-cache.md`](../../../../packages/auth/docs/reference/capability-cache.md).

`AUTH_SECRET` has a length floor: a short secret is a real weakness, and this schema is the only
place anyone will ever check.

`EMAIL_FROM` is never defaulted. An address the sending domain does not authorise bounces or lands in
spam, and a wrong default fails that way silently on the first real deploy.

`APP_BASE_URL` is not `AUTH_URL`, and the duplication is deliberate. `AUTH_URL` is Better Auth's own
origin and lives only in this schema; `APP_BASE_URL` is the origin a link inside a message points at,
and the worker needs it while parsing no auth configuration at all. Collapsing the two would put an
auth block in the worker's schema to serve one string.

## `trustedOrigins` has one home

Better Auth's CSRF check reads it through `containerConfig()`; the CORS layer reads it directly. Two
consumers, one list — a second hardcoded copy is how one of them goes stale.

## `Endpoint` exists because `Env` cannot

`Env` parses the full server schema at module load, so importing it from `router.tsx` or a route
component drags `DATABASE_URL` and `AUTH_SECRET` into the client bundle — where Vite replaces the
environment object with an empty one and the parse throws before the app can hydrate.

Client code needs two addresses, so it gets **two addresses and no schema**.

The RPC and auth paths are same-origin: the app is served by the same process that answers them, so
there is no host to configure. They are kept in step with the handler's `prefix` and with the file
routes that mount them, which spell the path again because `createFileRoute()` takes a literal the
generator reads without executing anything.

### Both addresses are absolute, and the RPC one was not

oRPC's `RPCLink` and Better Auth's client resolve their base through `new URL()` with **no second
argument**. A relative value therefore throws for both — Better Auth during SSR, and `RPCLink`
`TypeError: Failed to construct 'URL': Invalid URL` on the *first call the browser makes*.

`rpc` was relative for the life of the app, so no RPC call from a browser had ever succeeded.
Nothing saw it: SSR goes through `ApiClient.inProcess`, and every suite calls the handler or
`/api/rpc` directly. `rpcPath` now keeps the literal for the handler prefix and the route files;
`rpc` and `auth` are both built from one private `origin()`.

### Why the auth base URL ends in `.invalid`

Better Auth's client is the one caller that cannot take a path. It resolves `baseURL` through
`new URL()` **in its constructor**, so a relative value throws `BetterAuthError: Invalid base URL` —
during SSR, where there is no `location` to resolve against, which blanks the sign-in page behind a
failed Suspense boundary.

Every `AuthClient` method runs from a browser event, so the server never issues a request through
this value; it only has to parse. `.invalid` is reserved by RFC 2606 and is guaranteed never to
resolve, so a call that does slip into an SSR pass fails loudly and names that line rather than
quietly reaching some other localhost.

The desktop shell is cross-origin against both and supplies absolute URLs of its own through
`import.meta.env`.

## `vite build` must not load `.env`

`dev` and `preview` load the root `.env` because they run server code that needs it. **`build` must
not**, and the missing flag in `apps/web/package.json` is deliberate rather than an oversight.

`.env` sets `NODE_ENV=development` — correct for a local process, and `.env.example` ships it. Load
it into `vite build` and `@vitejs/plugin-react` emits the **development** JSX transform into the
production bundle: twenty-six files calling `jsxDEV`, which the production React build does not
export. The server then answers **500 on every page** with
`TypeError: (0 , import_jsx_dev_runtime.jsxDEV) is not a function`, while `/api/health` — which
renders no JSX — answers 200.

Every gate passes. `pnpm build` succeeds, the bundle assertion passes, `typecheck`, `lint` and the
suites are green, and the artefact is broken on its first request.

The build reads no configuration by design: `Env` is parsed at runtime and is server-only, and the
two addresses `Endpoint` holds are derived from `location`. Nothing at build time needs `.env`, so
nothing should hand it one.

## The shard block, and the two rules that make it safe

`DATABASE_SHARD_<n>_URL` names every node after node 0, with an optional
`DATABASE_SHARD_<n>_DIRECT_URL` beside each. Absent is one node, which is every deployment until
the split — `DATABASE_URL` is node 0 and also the catalog.

**Two rules, both enforced at boot rather than discovered later.** The indexes must be contiguous
from 1: the cluster indexes the array it builds, so a `DATABASE_SHARD_2_URL` with no shard 1
before it would put every tenant assigned to node 2 on the wrong database. And there is no
`DATABASE_SHARD_0_URL`: node 0 is `DATABASE_URL`, and a second name for one pool is a
disagreement waiting to happen about which is the catalog.

There is no range or key configuration here, and that is the design.
`shard_assignments` on the catalog names the node, one row per tenant, so adding a node is two
variables and a placement decision — not a config file two processes have to agree about. See
[sharding](../../../../packages/infrastructure/docs/reference/sharding.md).

## The six database variables, and which of them the pooler can see

`DATABASE_URL` goes through pgBouncer in transaction mode. `DATABASE_DIRECT_URL` goes past it, and
is what migrations, the seed, `drizzle-kit` and the activity archive use; it defaults to
`DATABASE_URL`, which is correct only while nothing is pooling.

`DATABASE_POOL_MAX`, `DATABASE_POOL_IDLE_TIMEOUT_MS` and `DATABASE_POOL_CONNECT_TIMEOUT_MS` are
this process's own `pg.Pool`, per replica rather than per cluster. The connect timeout is the one
with no previous default worth having: without it an unreachable Postgres holds a request for the
OS default, which is longer than every timeout in front of it.

`DATABASE_STATEMENT_TIMEOUT_MS` is the one value this file and `apps/worker/src/env.ts` deliberately
disagree about — 30 s here, 120 s there. A request a browser is waiting on and a batch nobody is
waiting on do not want the same ceiling.

**Through the pooler, that variable is not what enforces the timeout.** `pg` sends it as a startup
parameter, pgBouncer drops it, and `SHOW statement_timeout` reads `0`. Migration `0022`'s role
setting is the floor, and `PgUnitOfWork` raises it per transaction with `SET LOCAL`. The full
mechanism is in [`upstream:docs/infra/reference/pgbouncer.md`](https://github.com/prodicle/loadbearing_tanstack_start_kit/blob/3fafa78c2f42d2d718236d7666429b858199118a/docs/infra/reference/pgbouncer.md).

## The two realtime numbers are per process

`REALTIME_MAX_STREAMS_PER_USER` (8) caps how many concurrent streams one person may hold **on this
replica**, and `REALTIME_STREAM_MAX_AGE_SECONDS` (1800) is how long any one of them lives before it
ends and the client reconnects.

Neither is cluster-wide, and that is the decision rather than a limitation. A shared counter would
cost a Redis round trip on every stream open, and the failure the cap exists to prevent — one tab
in a reconnect loop opening streams faster than it closes them — is local to the replica it is
happening on. Behind a load balancer the effective per-person total is the cap times the replica
count, which is the right order of magnitude for a limit whose job is to bound one bug.

The age limit is what releases a channel nobody is reading. The server spreads it by ±10 % so tabs
opened together do not all end together. A stream ended by the server is not an error: the
client's `RealtimeStream` reopens it within a second and is replayed what it missed. That path is exercised on every
deploy anyway, so it is better to run it on a schedule than to discover it does not work at 3am.

## `SERVER_SHUTDOWN_TIMEOUT` is srvx's, and the container waits it out

Nitro's Node server is srvx. On `SIGTERM` it stops accepting, gives the requests in flight
`SERVER_SHUTDOWN_TIMEOUT` seconds — five by default — and then closes what is left. It fires no
Nitro `close` hook, and it does not exit the process: the preset wires neither.

So the web process disposed nothing (`CR.34`). Its pools and Redis sockets were dropped rather than
drained, and while they were open the process could not exit on its own; the orchestrator's kill
ended it. A `SIGTERM` listener that disposed at once would be worse, closing the pools under the
very requests srvx is letting finish.

`server/container.ts` listens for `SIGTERM` once, waits `Env.shutdownGraceMs` — srvx's window plus a
second — and disposes the container. `dispose` runs every step even when one throws, and a closed
Redis connection refuses to reopen, so a stream's `finally` that runs late cannot build a new
socket. The schema reads the variable srvx reads, rather than a second one of this app's own, so
the two cannot disagree.

**Checked by build, not by hand.** Windows delivers no catchable `SIGTERM`; the real signal on
Linux is `BACKLOG.md` §12's `CP7.5`.
