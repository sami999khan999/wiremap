---
title: pgbouncer
description: Transaction-mode pooling — the startup-parameter trap, the role floor that closes it, and the two verbs that are not interchangeable.
---

# `pgbouncer`

One process in front of Postgres, pooling connections in **transaction mode**: a server connection
is held for the length of a transaction and handed back the moment it commits. That is what lets
many application connections share few Postgres ones, and it is why
[`postgres`](postgres.md) runs with `max_connections=200` while `DEFAULT_POOL_SIZE` is 20.

`DATABASE_URL` points here. [`DATABASE_DIRECT_URL`](../../setup/13-infrastructure-postgres.md)
points past it, at `:5432`, and is what migrations, the seed, `drizzle-kit` and the activity
archive use.

## The container listens on 5432, not 6432

`edoburu/pgbouncer` sets its own `listen_port = 5432`. The compose entry maps
`${PGBOUNCER_PORT:-6432}:5432` and healthchecks `pg_isready -h localhost -p 5432`. Mapping
`6432:6432` produces a port nothing answers on and a healthcheck that reports unhealthy forever —
it looks like a pooler that will not start, and it is a pooler nobody is talking to.

## The startup-parameter trap

`pg` sends `statement_timeout` as a **startup parameter**. A transaction pooler cannot forward one,
because the server connection it would apply to belongs to whoever holds it next. pgBouncer's
answer is `IGNORE_STARTUP_PARAMETERS`, and both halves of what that does matter:

- **Without `statement_timeout` in the list, nothing connects at all.** pgBouncer closes the socket
  before authentication with `unsupported startup parameter: statement_timeout`, and drizzle
  reports it as a bare `Failed query` naming nothing.
- **With it in the list, the parameter is not weakened — it is gone.** `SHOW statement_timeout`
  through the pooler reads `0`. Unlimited, on every application connection.

So the ignore list is not a nicety that quiets a warning; it converts a refused connection into an
unlimited one. Migration `0022` is what makes that safe:

```sql
ALTER ROLE CURRENT_USER SET statement_timeout = '30s';
ALTER ROLE CURRENT_USER SET idle_in_transaction_session_timeout = '60s';
ALTER ROLE CURRENT_USER SET lock_timeout = '10s';
```

A role default is read when a **server** connection starts, which is the one mechanism a pooled
session inherits. Work that needs longer raises it per transaction with `SET LOCAL` inside
[`PgUnitOfWork.run`](../../../packages/infrastructure/docs/reference/unit-of-work.md).

`application_name` is the exception: pgBouncer tracks it natively, so it reaches
`pg_stat_activity` without an ignore-list entry and without a role setting.

**`CURRENT_USER` is whoever ran the migration.** The role that runs `db:migrate` must be the role
the application connects as. A deployment that separates them lands the floor on the migrator and
leaves the application at `0`, with nothing in either log saying so.

## Never issue a session-level `SET`

In transaction mode pgBouncer does **not** run `server_reset_query` — `DISCARD ALL` is configured
and, without `server_reset_query_always = 1`, never executes. A session-level `SET` on a pooled
connection therefore survives, and is inherited by every client that is later handed that server
connection. Measured: one client setting `statement_timeout = '7s'` was followed by twenty-five
fresh clients that all read `7s`.

One `SET` does not poison one connection. It poisons the pool.

The repository is clean today — no `SET`, no `LISTEN`/`NOTIFY`, no cursors, no temporary tables, no
session-level advisory locks, no named prepared statements; the three advisory locks are all
`pg_advisory_xact_lock`, which dies with its transaction. `SET LOCAL` is always correct and always
what to reach for. Turning `SERVER_RESET_QUERY_ALWAYS` on would buy insurance at the price of one
round trip per transaction; the rule is cheaper, and `tests/smoke/pooled.smoke.spec.ts` is what
notices if it stops being true.

## `RECONNECT`, never restart

A role setting applies to new server connections. Connections already open when migration `0022`
lands keep their old value until they close — `server_idle_timeout` (600 s) for an idle pool, up to
`server_lifetime` (3600 s, randomised) for a busy one. The deploy step is:

```
psql "postgres://ratchet:ratchet@localhost:26432/pgbouncer" -c "RECONNECT"
```

**Not a restart.** `RECONNECT` closes server-side connections and leaves clients alone. Restarting
the container drops every client socket, and `pg` raises those on *idle* clients as a pool `error`
event — which the worker turns into `uncaughtException` and `exit(1)`. `Database` now registers a
listener (`database.pool.error`) so the process survives, but the two verbs still are not
interchangeable.

## Saturation is invisible from inside the application

`Container.health()` reports `pool: { total, idle, waiting, max }` off this process's own
`pg.Pool`. That number cannot see the pooler. With `DEFAULT_POOL_SIZE=2` and three concurrent
transactions from one `Pool({ max: 10 })`, the application reads `waiting: 0` while the pooler
reports `cl_waiting=1`. After `query_wait_timeout` (120 s by default) the client gets an error it
has no counter for.

`database.pool.saturated` fires on this side, and its sampling window is derived from
`DATABASE_POOL_CONNECT_TIMEOUT_MS` rather than fixed. That is not a detail: `waiting` cannot outlive
the connect timeout, because the caller is rejected when it expires. A probe with a ten-second
window against a five-second connect timeout would never fire once.

**A readiness probe competes with the traffic it reports on.** `Container.health()` reads
`stats()` for free, but `isHealthy()` runs `SELECT 1` and queues for a pool slot like anything
else. Under real saturation `/api/health` is slow for the same reason the requests are — worth
knowing before a liveness probe with a short timeout takes a busy replica out of rotation.

Ask the pooler:

```
psql "postgres://ratchet:ratchet@localhost:26432/pgbouncer" -c "SHOW POOLS"
```

`cl_active`, `cl_waiting`, `sv_active` and `maxwait` are the four that matter. `ADMIN_USERS`
is what makes both this and `RECONNECT` available.

## What a transaction pooler does not break

Worth knowing, because the list is shorter than the folklore suggests. Verified against the running
stack, and asserted by `tests/smoke/pooled.smoke.spec.ts`:

| | |
|---|---|
| Savepoints — a nested `run()` | fine |
| `pg_advisory_xact_lock` | fine, serialises across connections |
| `FOR UPDATE SKIP LOCKED` — the outbox drain's one-statement claim | fine, claims stay disjoint |
| Better Auth's `drizzleAdapter` | fine — it opens no transaction of its own |
| `ALTER TABLE … DETACH PARTITION … CONCURRENTLY` | fine **as a single statement** |

The last one is the common misconception. It fails inside a transaction — on a direct connection
just as surely as a pooled one — and the pooler has nothing to do with it.

## Sizing

`DEFAULT_POOL_SIZE` × databases × pgBouncer instances must stay under Postgres's
`max_connections`, with headroom for superuser connections and `RESERVE_POOL_SIZE`. The
application's own `DATABASE_POOL_MAX` is now what it costs pgBouncer in *client* slots
(`MAX_CLIENT_CONN`), not what it costs Postgres — which is the whole point of putting one here.

A managed pooler replaces this container with no code change: it is [Tier
0](../../opinions/dependencies.md), the deployment runs it, and no manifest names it.
