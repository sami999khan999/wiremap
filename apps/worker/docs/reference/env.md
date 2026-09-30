---
title: Env
description: The second and last process.env reader — why its schema is smaller than the web app's, why the two are deliberately not shared, and what each concurrency value is protecting.
---

# `Env`

The second and last `process.env` reader in the repository; the other is `apps/web/src/env.ts`.
Everything else receives configuration.

## Deliberately not shared with the web app's schema

A common schema would force this process to carry an `AUTH_SECRET` it never uses — **one more secret
in one more environment for no reason.** The worker builds a `Container` with no auth config at all
and resolves no credential; it constructs a `SystemPrincipal` from a named grant list instead.

`env.ts` is also the one file in this app that does not read `import.ts`: it carries the schema that
turns the environment into a `ContainerConfig`, and it is parsed before anything else in the process
exists.

## Concurrency: serial, and only one of the two is a dial

| Variable | Default | Why |
|---|---|---|
| `WORKER_MAINTENANCE_CONCURRENCY` | 1 | Maintenance jobs take table-level locks and run nightly. Two overlapping buys nothing and can deadlock on the same partition |
| `WORKER_PROJECTION_CONCURRENCY` | 1 | **Not a dial worth turning.** Two projection runs read the same checkpoint, project the same rows, and turn one batch into two — correctness rests on there being exactly one writer, not on the insert being idempotent |

## `WORKER_SHUTDOWN_TIMEOUT_MS`

How long `worker.close()` is given to drain in-flight jobs before the process exits anyway.

**Longer than your longest job, shorter than your orchestrator's SIGKILL timer.** A value above that
timer just means the platform kills you mid-drain. See [`shutdown.md`](./shutdown.md).

## SMTP is required in both processes

Both build a `Container`, and the container treats mail as required configuration rather than
optional: a container that cannot send is one whose sign-ups never complete. Same URL shape as the
web app's.

The worker is now the *only* process that actually sends. Every mail is a job on `QueueName.MAIL`
and `MailConsumer` is what renders and hands it to SMTP, so these two keys stopped being speculative
the day the pipeline landed. The web app still parses them because it builds the same `Container`.

`APP_BASE_URL` is required here for the same reason: the worker renders the invitation link, and it
parses no auth configuration to borrow an origin from. It is deliberately *not* `AUTH_URL`, which is
Better Auth's own and exists only in the web app's schema.

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

## The swappable stores

A driver plus the connection detail that driver needs. `Container` reads the driver and builds the
class behind the port, so adopting a store is these variables and nothing else.

The ClickHouse block is optional, and **its absence is what keeps ClickHouse stopped**. Present, the
projection runs and the reconciliation reports; nothing reads the store back, because there is no
analytics reader. There is no read driver to flip, and that is the point — a flag that moved reads
the moment the pipeline started would cut a dashboard over to a store still backfilling. See
[`composition/docs/reference/container.md`](../../../../packages/composition/docs/reference/container.md).

**Setting `CLICKHOUSE_URL` makes `CLICKHOUSE_DATABASE` and `CLICKHOUSE_USER` required.** Both default
to ClickHouse's own `default`, and the compose container is `ratchet` — so the defaults cannot reach
the only ClickHouse this kit ships. The schema refuses them rather than letting the projection fail
on its first run with a vendor auth error.

## Logging

The same block the web app parses. A worker with no log output is a worker you cannot operate, and
`LOG_PRETTY` must stay false anywhere Alloy is reading — it is a terminal format, and Alloy's JSON
stage drops what it cannot parse.

## The four concurrency knobs are not one knob

Each is per worker *instance*, never global: four instances at concurrency 4 is sixteen in-flight
jobs, every one of which may hold a Postgres connection.

- `WORKER_EMBEDDING_CONCURRENCY` (4) — bounded by the embedding provider's rate limit and your pool.
- `WORKER_MAINTENANCE_CONCURRENCY` (1) — serial, because these jobs take table-level locks.
- `WORKER_ANALYTICS_CONCURRENCY` (1) — capped at 1 *by the schema*: correctness rests on one writer.
- `WORKER_MAIL_CONCURRENCY` (4) — with `WORKER_MAIL_RATE_PER_MINUTE` (600) as the provider's cap,
  which is a BullMQ `limiter` on that queue rather than a sleep in every caller.
- `WORKER_EVENT_CONCURRENCY` (8) — the highest, because deliveries are subscriber work and one
  event fans out to one job per subscriber. The drain itself runs at `priority: 1` ahead of them,
  so a delivery backlog cannot starve it.

## Count your processes, and now your concurrencies

The five knobs above are per instance, and they are also drawn against one pool. `WorkerBootstrap`
sums the concurrency of the consumers that actually **started** — not the six in the tree, because
`AnalyticsConsumer` starts only with a ClickHouse config — and emits `worker.pool.oversubscribed`
when the sum exceeds `DATABASE_POOL_MAX`. At the defaults that is 20 against 10, and the line fires
on every boot until one of the two numbers moves.

It is a warning rather than an error because plenty of jobs hold no connection at all. But
`WORKER_EVENT_CONCURRENCY` (8) counts fully: `PgOutboxGateway.drain` awaits its relay **inside**
`unitOfWork.run`, so an in-flight batch pins a pool connection — and a pgBouncer server slot — for
the whole of its Redis round trips.

`DATABASE_STATEMENT_TIMEOUT_MS` defaults to 120 s here against the web app's 30 s, and that is the
one field the two schemas deliberately disagree about. Through pgBouncer it reaches the server as a
`SET LOCAL` inside `PgUnitOfWork.run`, never as a startup parameter — see
[`upstream:docs/infra/reference/pgbouncer.md`](https://github.com/prodicle/loadbearing_tanstack_start_kit/blob/3fafa78c2f42d2d718236d7666429b858199118a/docs/infra/reference/pgbouncer.md).

## The two realtime numbers are per process

`REALTIME_MAX_STREAMS_PER_USER` (8) caps how many concurrent streams one person may hold **on this
replica**, and `REALTIME_STREAM_MAX_AGE_SECONDS` (1800) is how long any one of them lives before it
ends and the client reconnects.

Neither is cluster-wide, and that is the decision rather than a limitation. A shared counter would
cost a Redis round trip on every stream open, and the failure the cap exists to prevent — one tab
in a reconnect loop opening streams faster than it closes them — is local to the replica it is
happening on. Behind a load balancer the effective per-person total is the cap times the replica
count, which is the right order of magnitude for a limit whose job is to bound one bug.

The age limit is what releases a channel nobody is reading. A stream ended by the server is not an
error: the client reconnects and is replayed what it missed. That path is exercised on every
deploy anyway, so it is better to run it on a schedule than to discover it does not work at 3am.

The worker parses both and uses neither: it builds a container, and a container builds a realtime
subscriber. Nothing in a worker opens a stream, so the connection behind it is never created — which
is what makes `health().realtime` honestly `null` there rather than a socket opened to answer the
question.
