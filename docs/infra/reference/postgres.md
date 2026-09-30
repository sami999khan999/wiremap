---
title: postgres
description: The source of truth — the pgvector image, the three extensions, and why the init script runs exactly once.
---

# `postgres`

The store that owns anything a transaction depends on or a user reads immediately after writing:
domain rows, RBAC, the audit trail, auth tables, and embeddings.

| | |
| --- | --- |
| **Image** | `pgvector/pgvector:pg17` |
| **Inside the network** | `postgres:5432` |
| **From the host** | `localhost:25432` |
| **Credentials** | `ratchet` / `ratchet`, database `ratchet` |
| **Volume** | `pgdata` |
| **Config file** | `postgres.init.sql` |

---

## Why this image

`pgvector/pgvector:pg17` is stock Postgres 17 with the `vector` extension *available to enable*.
Using the official `postgres` image and installing pgvector yourself works, and pins you to building
an image on every developer machine and every CI runner.

**Postgres 17 rather than 16** for the improved `VACUUM` memory behaviour, which matters on the
activity log more than anywhere else — though the real answer for that table is monthly partitioning
and a retention policy, which [13](../../setup/13-infrastructure-postgres.md) sets up in the first
migration.

---

## `postgres.init.sql`

```sql
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
```

Mounted at `/docker-entrypoint-initdb.d/01-extensions.sql`. The `01-` prefix is the execution order
the entrypoint sorts by — irrelevant with one file, and the reason to keep the convention if a second
ever appears.

**`vector`** is the extension the image exists for. The column type `vector(1536)` in
[14](../../setup/14-vector-store.md) does not exist without it, and the migration fails on
stock Postgres with an error that reads like a typo.

**`pg_stat_statements`** is the measurement that answers "which query" before any move on the
scaling ladder. It needs `shared_preload_libraries=pg_stat_statements`, which the compose `command`
sets — the flag without the extension gives an absent view rather than an error, which is the
confusing half of getting it wrong.

**`pg_trgm`** is trigram indexing for fuzzy text search. Every product ends up wanting
`WHERE name % 'searchterm'`, and enabling an extension in a later migration means a lock on a live
database. It is free until used.

**`uuid-ossp`** is belt-and-braces. IDs are generated in application code by `Uuid.v7()`, so nothing
needs it — but a data-repair SQL script that has to invent an id should not require a round trip
through Node.

> **`"uuid-ossp"` is quoted because of the hyphen.** Unquoted, Postgres parses it as
> `uuid - ossp` — a subtraction — and reports a syntax error that names neither the extension nor the
> hyphen.

---

## The init script runs exactly once

Scripts in `/docker-entrypoint-initdb.d` run **only when the data directory is empty**. On every
later start the entrypoint sees an initialised cluster and skips them entirely.

That is the single most common confusion with this file: editing it and restarting does nothing.

```bash
# apply a change to an existing volume
docker compose -f infra/docker-compose.yml exec postgres \
  psql -U ratchet -d ratchet -c "CREATE EXTENSION IF NOT EXISTS pg_trgm;"

# or start over
pnpm infra:reset
```

> Address the container by **service name** (`postgres`), not by a shell-substituted container ID.
> That is what makes these commands identical in PowerShell and bash.

---

## Who connects, and how

| Consumer | Reaches it at | For |
|---|---|---|
| `apps/web`, `apps/worker` (host) | `localhost:26432` | everything, via `DATABASE_URL` — **through [pgBouncer](pgbouncer.md)** |
| `migrate.ts`, `seed.ts`, `drizzle-kit` (host) | `localhost:25432` | DDL, via `DATABASE_DIRECT_URL` |
| `migrate.ts`, `partitions.ts`, under the `sharded` profile | `localhost:25433` | the same DDL on node 1, via `DATABASE_SHARD_1_DIRECT_URL` |
| `PgPartitionArchiveGateway` | `localhost:25432` | `DETACH … CONCURRENTLY` and a month-long stream |

**Two different hostnames for one database**, and the difference is which side of the bridge network
the client is on. A container using `localhost:25432` would reach *its own* loopback and find
nothing.

Connections are pooled per process at `DATABASE_POOL_MAX` (10 by default,
[13](../../setup/13-infrastructure-postgres.md)) — but they are no longer counted against
`max_connections`, because [pgBouncer](pgbouncer.md) is in front of them. What replicas cost now is
pgBouncer *client* slots (`MAX_CLIENT_CONN`, 1000); what Postgres sees is `DEFAULT_POOL_SIZE` (20).
That is the whole reason the pooler is in the core stack rather than filed as a later move.

`max_connections` is 200 here, set by the compose `command` alongside
`shared_preload_libraries=pg_stat_statements` and `track_io_timing=on`. Size it as
`DEFAULT_POOL_SIZE × databases × pooler instances`, plus headroom for superusers and
`RESERVE_POOL_SIZE`.

**`DATABASE_DIRECT_URL` is this port, and it is not optional in a pooled deployment.** Migrations,
the seed, `drizzle-kit` and the activity archive's `DETACH … CONCURRENTLY` need a connection with
no pooler in it — and the timeout floor migration `0022` sets only reaches a session through the
pooler once its server connections have been recycled with `RECONNECT`.

---

## One container is the catalog and node 0 at once

There is one Postgres in the default stack and there is meant to be. The application reaches it
through a `DatabaseCluster` and a key, every table is `catalog`, `local` or `routed`, and every
tenant's row in `shard_assignments` names node 0 — so the routing runs for real against one
machine, which is what makes a second one two environment variables rather than a project.

`pnpm infra:up:sharded` starts `postgres-shard-1` and `pgbouncer-shard-1` on `:5433`/`:6433`, same
image and same `postgres.init.sql`, on their own volume. That is for rehearsing the split and not
for running one — `tests/smoke/sharded.smoke.spec.ts` is what it exists for. See
[sharding](../../../packages/infrastructure/docs/reference/sharding.md) and
[compose](compose.md).

**`pgvector` has to be on every node, which is why the shard shares the init script.** A routed
table with an embedding column on a database with no extension fails at insert, not at boot.

---

## Checking it

```bash
docker compose -f infra/docker-compose.yml exec postgres \
  psql -U ratchet -d ratchet -c "SELECT extname FROM pg_extension;"
```

`vector`, `pg_trgm`, `uuid-ossp` alongside `plpgsql`. If `vector` is missing, the volume predates the
init script.

```bash
docker compose -f infra/docker-compose.yml exec postgres pg_isready -U ratchet -d ratchet
```

The same command the healthcheck runs.
