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
| **From the host** | `localhost:45432` |
| **Credentials** | `ratchet` / `ratchet`, database `ratchet` |
| **Volume** | `pgdata` |
| **Config file** | `postgres.init.sql` |

---

## Why this image

`pgvector/pgvector:pg17` is stock Postgres 17 with the `vector` extension *available to enable*.
Using the official `postgres` image and installing pgvector yourself works, and pins you to building
an image on every developer machine and every CI runner.

**Postgres 17 rather than 16** for the improved `VACUUM` memory behaviour, which matters on the
activity log more than anywhere else — though the real answer for that table is partitioning,
which [13](../../setup/13-infrastructure-postgres.md) sets up in the first migration.

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
| `apps/web`, `apps/worker` (host) | `localhost:45432` | everything, via `DATABASE_URL` |
| `migrate.ts`, `seed.ts`, `drizzle-kit` (host) | `localhost:45432` | DDL, via `DATABASE_DIRECT_URL` |
| `PgPartitionArchiveGateway` | `localhost:45432` | `DETACH … CONCURRENTLY` and a month-long stream |

**Two different hostnames for one database**, and the difference is which side of the bridge network
the client is on. A container using `localhost:45432` would reach *its own* loopback and find
nothing.

**Two URLs, one server.** `DATABASE_URL` and `DATABASE_DIRECT_URL` are the same address in lite.
There is no pooler. The direct URL is kept as a name so adding one later is an `.env` and compose
change, not a code change — [pgbouncer](../../scale/pgbouncer.md).

**The code is already written for a transaction pooler.** It sets nothing per session. The timeout
floor — `statement_timeout`, `idle_in_transaction_session_timeout`, `lock_timeout` — is an
`ALTER ROLE` in the baseline migration, so it holds with or without a pooler in the way.

Connections are pooled per process at `DATABASE_POOL_MAX` (20 in `.env.example`,
[13](../../setup/13-infrastructure-postgres.md)). With no pooler, each one is a real backend.
Count your processes against `max_connections`.

`max_connections` is 200 here, set by the compose `command` alongside
`shared_preload_libraries=pg_stat_statements`, `track_io_timing=on` and
`max_locks_per_transaction=1024`. The locks setting is raised because every tenant is partitions:
a statement the planner cannot prune by tenant locks every leaf
([partitions](../../../packages/infrastructure/docs/reference/partitions.md)).

**A volume migrated before the lite squash needs `pnpm infra:reset`.** The migrations are now
`packages/infrastructure/migrations/0000_lite_baseline.sql` plus two small ones, and an old
volume's history does not match them.

---

## One container is the catalog and node 0 at once

There is one Postgres in the stack and there is meant to be. The application reaches it
through a `DatabaseCluster` and a key, every table is `catalog`, `local` or `routed`, and every
tenant's row in `shard_assignments` names node 0 — so the routing runs for real against one
machine, which is what makes a second one environment variables rather than a project.

Lite runs no second node and no replica. `DATABASE_SHARD_<n>_URL` and `DATABASE_REPLICA_URL` are
still read; unset, there is one node and every read goes to the primary. Adding either is
[shard-nodes](../../scale/shard-nodes.md) or [read-replica](../../scale/read-replica.md). See also
[sharding](../../../packages/infrastructure/docs/reference/sharding.md).

**`pgvector` has to be on every node, so a new node shares the init script.** A routed table with
an embedding column on a database with no extension fails at insert, not at boot.

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
