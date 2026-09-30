---
title: docker-compose.yml
description: Five services, no profiles, three volumes and one network — what every block does and which parts are load-bearing.
---

# `docker-compose.yml`

The only file here that Docker reads directly. Everything else is mounted into a container by it.

```yaml
name: lite
```

**The project name.** It prefixes every container (`lite-postgres-1`), every volume (`lite_pgdata`)
and the network (`lite_default`). Two stacks with the same name on one machine share all three.

---

## The network

There is no `networks:` block, which is itself the decision. Compose creates `lite_default` — a
bridge network — and joins every service to it.

Inside that network, **a service name is a hostname**. Docker runs an embedded DNS server at
`127.0.0.11` in each container, so `minio` resolves to the MinIO container's address without anything
being configured. That is why `minio-init` can say `http://minio:9000`.

Declaring networks explicitly would buy segmentation — keeping a log shipper off the database, say.
That is worth doing in production and is noise here, where every service is on one machine and the
isolation would be theatre.

---

## Services

### The four stores

| Service | Image | Notes |
|---|---|---|
| `postgres` | `pgvector/pgvector:pg17` | [postgres](postgres.md) |
| `redis` | `redis:7-alpine` | cache, queue and realtime; never evicts, always persists — [redis](redis.md) |
| `mailpit` | `axllent/mailpit:latest` | SMTP sink — [mailpit](mailpit.md) |
| `minio` | `coollabsio/minio:RELEASE.2025-10-15T17-29-55Z` | S3 stand-in — [minio](minio.md) |

Mailpit is a store only in the loosest sense: it holds mail in memory until restart.

`minio-init` is a fifth, and it is a **one-shot**: an `mc` image runs an entrypoint that waits for
the MinIO API, creates the `ratchet` bucket and exits. `exited (0)` is success, and `compose-wait.mjs` holds
the stack un-ready until it is — a one-shot still running is doing the work the next step reads. It carries `restart: "no"` and no healthcheck, because a
container that is supposed to stop cannot be "unhealthy" — and without the explicit `restart` the
project default would keep starting a container whose whole job is to finish.

### What lite does not run

The big kit also ran a pooler, a streaming replica, a second shard node and its pooler, a
split Redis, Loki and Alloy for logs, ClickHouse for analytics, and a cold MinIO tier. Lite runs
none of them. The code keeps the seams, so each is a port back rather than a rewrite:

| Missing piece | Porting guide |
|---|---|
| pgBouncer | [pgbouncer](../../scale/pgbouncer.md) |
| `postgres-replica` | [read-replica](../../scale/read-replica.md) |
| `postgres-shard-1` and its pooler | [shard-nodes](../../scale/shard-nodes.md) |
| `redis-cache` / `redis-queue` | [split-redis](../../scale/split-redis.md) |
| Loki and Alloy | [logs](../../scale/logs.md) |
| ClickHouse | [analytics](../../scale/analytics.md) |
| `minio-cold` | [retention](../../scale/retention.md) |

---

## Profiles

There are none. Every service starts on every `up`:

```bash
docker compose ... up -d                                  # 5 services
```

`pnpm infra:up` and `pnpm infra:core` both run exactly that.

> **`down`, `reset` and `logs` still pass `--profile "*"`.** Compose only acts on services in the
> profiles it was given. With no profiles it changes nothing today. It stays so a profiled service
> added later — a ported pooler, say — is not left running by a reset or missing from `logs -f`.

---

## Volumes

Three named volumes, and which are disposable is the whole point.

| Volume | Service | Rebuildable from |
|---|---|---|
| `pgdata` | postgres | migrations + seeds |
| `redisdata` | redis | **nothing** — it holds the queue |
| `miniodata` | minio | **nothing** — uploads are a second source of truth |

**Redis has a volume because the queue shares it.** A cache alone would not earn one. A job in the
queue is derived from nothing, so the one instance persists.

`pnpm infra:reset` destroys all three. Locally that is fine — it is a scratch database. The habit is
what matters: in any environment with real pending work, flushing Redis here flushes the queue too.
Clearing the cache on its own needs the split in [split-redis](../../scale/split-redis.md).

**A volume migrated before the lite squash needs `pnpm infra:reset`.** Migrations are now
`packages/infrastructure/migrations/0000_lite_baseline.sql` plus two small ones, and the old history does not match.

### Bind mounts

The one config file is mounted on its own, read-only:

```yaml
- ./postgres.init.sql:/docker-entrypoint-initdb.d/01-extensions.sql:ro
```

Docker creates the target's parent directories if they do not exist, so a single file can be placed
into a path the image never had. That is what removed the directory-per-service layout this folder
used to have.

> **A single-file bind mount does not survive an editor that replaces the file.** Some editors write
> a new inode rather than modifying in place, and the container keeps the old one. Restart the
> service after editing a config; every one of these is read at startup anyway.

---

## Host ports

Every host port is a variable with the documented default; every container port is fixed.

```yaml
ports: ["${MINIO_CONSOLE_PORT:-29001}:9001"]
```

Port collisions on a developer machine are not hypothetical — this stack met one on its first run,
where `9001` was already held by an unrelated tool, and later met five at once against two other
projects. So every published port is the well-known one with a `1` in front, which keeps it
readable as the service it belongs to and leaves `2xxxx` for the next stack on the same machine.

**They live in the root `.env`, and it is the only env file.** Compose used to read `infra/.env`
instead — with `-f infra/docker-compose.yml` the project directory is `infra/`, not the repository
root — so the stack and the applications each had their own idea of where Postgres was, and nothing
compared them. `pnpm infra:up` now goes through `tooling/scripts/compose.mjs`, which passes
`--env-file <root>/.env` when that file exists. It has to be conditional: `--env-file` errors on a
missing file, compose has no `-if-exists` form, and CI runs the stack with no `.env` at all.

| Variable | Default | Variable | Default |
|---|---|---|---|
| `POSTGRES_PORT` | 25432 | `SMTP_PORT` | 21025 |
| `REDIS_PORT` | 26379 | `MAILPIT_UI_PORT` | 28025 |
| `S3_PORT` | 29000 | `MINIO_CONSOLE_PORT` | 29001 |

These defaults are what a checkout with no `.env` gets, which is exactly what CI is, so
`check:architecture` §27 asserts each one equals the value `.env.example` documents. It also pairs
each `*_PORT` with the URL that dials it — `POSTGRES_PORT` with both `DATABASE_URL` and
`DATABASE_DIRECT_URL`, `REDIS_PORT` with both Redis URLs — and fails when the two disagree.
`MINIO_CONSOLE_PORT` and `MAILPIT_UI_PORT` have no counterpart: nothing in the application dials
them, you do.

**Nothing inside the network changes when you override one**, because only the left-hand side moves.
`minio-init` still says `minio:9000` regardless of `S3_PORT`.

---

## Healthchecks and `depends_on`

Every long-running service but one has a healthcheck, because `depends_on` alone only waits for a
container to *start*, not to be *usable*. MinIO is the exception — see below.

The only `depends_on` in the file is `minio-init: depends_on: [minio]`, which waits for the container
to start. The retry loop inside `minio-init` does the rest.

**MinIO** has no probe, having had two that could not run. `mc ready local` needed a binary the
server image does not ship, and the `local` alias it named is created by `minio-init` — which was
itself waiting on that healthcheck. `curl -sf /minio/health/live` replaced it and lasted until the
image did: the community rebuild that took over from the withdrawn `minio/minio` ships no `curl`
either, so the container sat unhealthy while the server logged that it was serving.

The third version does not guess at the image's contents. `minio-init` retries `mc alias set` until
the API answers, which is a real readiness check — it is the first thing that has to work anyway —
and it depends on no binary being present anywhere except the `mc` this project chose. `minio` is
consequently the one long-running service `compose-wait.mjs` passes on `running` alone.

---

## Checking it

```bash
docker compose -f infra/docker-compose.yml --profile '*' config --quiet   # valid?
docker compose -f infra/docker-compose.yml --profile '*' config --services # what would run
docker network inspect lite_default --format '{{range .Containers}}{{.Name}} {{.IPv4Address}}{{"\n"}}{{end}}'
```

`config` resolves variables, applies `.env`, and validates the schema without starting anything — it
is the fastest way to check an edit, and it is what CI should run if this file ever grows.
