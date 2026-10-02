---
title: infra
description: The local stack — every file, every service, and how they reach each other. Five containers, no profiles, one bridge network.
---

# `infra/`

> The files documented here live in [`infra/`](../../infra/docs/index.md) at the repository root —
> `docker-compose.yml` and the Postgres init script. The documentation sits under `docs/` with
> every other tree; the configuration stays next to the compose file that mounts it.

Everything the application talks to, as containers. Nothing here is imported by any package — these
are [Tier 0](../opinions/dependencies.md) dependencies, provided by the deployment and
reached over a protocol the code was going to speak anyway.

[11 · Local Infrastructure](../setup/11-local-infrastructure.md) is the build order and
explains *why* each choice was made. **This is the reference:** what each file does, how each service
works, and how they connect.

**Running it somewhere other than a laptop is [deployment](deployment.md)** — the same services on a
VPS, and the order to move them to managed services in when one box stops fitting.

---

## Every file

| File | Read by | Explained in |
|---|---|---|
| `docker-compose.yml` | `docker compose` | [compose](reference/compose.md) |
| `postgres.init.sql` | Postgres, on first boot only | [postgres](reference/postgres.md) |
| `.env` | `docker compose` | [compose](reference/compose.md#host-ports) |

Redis, Mailpit and MinIO have no config file — every setting is a command-line flag, an
environment variable or a default. See [redis](reference/redis.md), [mailpit](reference/mailpit.md)
and [minio](reference/minio.md).

**The config files are flat on purpose.** Each is mounted as a single file, so a directory per
service would be a path holding one thing. `docs/` is nested because there is genuinely a page's worth
to say about each — which is what earns structure ([Simplicity](../opinions/simplicity.md)).

This is the opposite answer from the one `packages/infrastructure/src/` gives, and the difference is
what each directory holds. There, each vendor gets a folder, because each is several TypeScript
modules and the folder is the unit of "what does this package depend on". Here, each service is at
most one mounted file. **Structure is earned by contents, not by symmetry with another directory.**

---

## How the services connect

Compose creates one bridge network, `wiremap_default`, and joins every container to it. Inside that
network **a container reaches another by its service name** — Docker's embedded DNS resolves `minio`,
`postgres` and so on to the container's address.

```
                    ┌──────────────────────────── host ─────────────────────────────┐
                    │                                                               │
   pnpm dev ────────┼──→ :45432 postgres   :46379 redis   :49000 minio (S3)         │
   (apps on host)   │    :41025 mailpit (SMTP)                                      │
                    │                                                               │
                    └───────────────────────────────────────────────────────────────┘
                                              │
   ══════════════════════════ wiremap_default (bridge) ═══════════════════════════════════

     ┌──────────┐   ┌───────┐   ┌─────────┐   ┌───────┐ ←── mc mb ── ┌────────────┐
     │ postgres │   │ redis │   │ mailpit │   │ minio │              │ minio-init │
     └──────────┘   └───────┘   └─────────┘   └───────┘              └────────────┘
```

**Three things to take from that picture.**

**Nothing connects to the applications.** Traffic runs one way: the apps dial Postgres, Redis,
Mailpit and MinIO from the host.

**Only `minio-init` talks to another container.** It dials `minio:9000` to create the bucket, then
exits. No other service depends on another.

**Logs go to stdout and nowhere else.** Each app writes JSON lines to stdout. No container collects
them. `docker compose logs` covers the containers; your terminal covers the apps. Collecting and
searching them is [logs](../scale/logs.md).

### Ports: inside versus outside

Two numbers per service, and confusing them is the usual source of "connection refused".

| Service | Inside the network | From the host |
|---|---|---|
| postgres | `postgres:5432` | `localhost:45432` — `DATABASE_URL` and `DATABASE_DIRECT_URL` |
| redis | `redis:6379` | `localhost:46379` — `REDIS_CACHE_URL` and `REDIS_QUEUE_URL` |
| mailpit | `mailpit:1025`, UI `mailpit:8025` | `localhost:41025`, UI `localhost:48025` |
| minio | `minio:9000`, console `minio:9001` | `localhost:49000`, console `localhost:49001` |
| minio-init | — | — |

**Two database URLs, one server.** `DATABASE_URL` and `DATABASE_DIRECT_URL` both reach Postgres
directly. They are two names so adding a pooler later is an `.env` and compose change —
[pgbouncer](../scale/pgbouncer.md).

**Two Redis URLs, one instance.** Splitting cache from queue is the same kind of change —
[split-redis](../scale/split-redis.md).

---

## Startup order

Only one dependency is declared:

```
minio ──started──→ minio-init ──→ exits 0
```

`minio-init` retries `mc alias set` until the MinIO API answers, so it needs no healthcheck on MinIO.
Everything else starts in parallel — Postgres, Redis, Mailpit and MinIO have no dependencies on each
other.

**`minio-init` is a one-shot container.** It creates the `ratchet` bucket and exits, so `exited (0)`
in `docker compose ps` is success. Without it the first upload fails with `NoSuchBucket` and everyone
goes looking for a code bug.

---

## What flows where

| Data | From | To | Durable? |
|---|---|---|---|
| Domain rows, audit trail | use-cases | Postgres | **yes** — the source of truth |
| Uploaded files | `StorageGateway` | MinIO `ratchet` | **yes** — a second source of truth |
| Tenant exports | worker | MinIO `ratchet`, `export/` | no — expire after 7 days |
| Deleted-tenant archives | worker | MinIO `ratchet`, `cold/` | 30 days, then swept |
| Outbound mail | `SmtpEmailSender` | mailpit *(delivered nowhere)* | no — in memory, cleared on restart |
| Capability and session cache | `CacheStore` | redis | no — rebuilt from Postgres |
| Queued jobs | `QueuePublisher` | redis | **yes** — derived from nothing |
| Diagnostic log lines | `JsonLogger` | stdout | no — whatever your terminal keeps |

The rule behind that column is [Data and scale](../opinions/data-and-scale.md): **Postgres
owns anything a transaction depends on or a user reads immediately after writing; everything else is
a derived store behind a port.**

The cache and the queue share one Redis, so it runs with `noeviction` and durable AOF. The queue's
rules win; every cache key carries a TTL instead ([redis](reference/redis.md)).

---

## Running it

```bash
pnpm infra:up              # all five services   ← the normal command
pnpm infra:core            # the same thing — kept as an alias
pnpm infra:down            # stop everything, keep volumes
pnpm infra:reset           # stop everything, destroy volumes
pnpm infra:logs            # tail every service
```

There are no profiles. Every service starts every time.

> `down`, `reset` and `logs` still pass `--profile "*"`. With no profiles it changes nothing. It stays
> so a profiled service added later is not left running by a reset.

**Credentials are `ratchet` / `ratchet` everywhere except MinIO**, which is `ratchet` /
`ratchetsecret`. They are hard-coded on purpose: this stack holds nothing worth protecting, and a
scratch database behind a secret is a scratch database nobody can debug.

**A database migrated before the lite squash needs `pnpm infra:reset`.** The migrations are now one
baseline plus two small ones, and an old volume's history does not match them.

---

## Checking the whole stack

```bash
docker compose -f infra/docker-compose.yml ps
```

`postgres`, `redis` and `mailpit` `healthy`. `minio` `running` — it has no healthcheck.
`minio-init` `exited (0)`.

Per-service checks are on each reference page. The most common failures across all of them:

| Symptom | Usually |
|---|---|
| `connection refused` from inside a container | Used the host port instead of the container port |
| `NoSuchBucket` on first upload | `minio-init` did not finish — `docker compose logs minio-init` |
| Migrations fail on an old volume | The volume predates the squash — `pnpm infra:reset` |
| Port already allocated | Something else owns it — [compose](reference/compose.md#host-ports) |
