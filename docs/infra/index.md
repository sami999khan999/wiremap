---
title: infra
description: The local stack — every file, every service, and how they reach each other. Nine containers, two profiles, one bridge network.
---

# `infra/`

> The files documented here live in [`infra/`](../../infra/docs/index.md) at the repository root —
> `docker-compose.yml`, the two init scripts, and the Loki/Alloy configs. The documentation sits
> under `docs/` with every other tree; the configuration stays next to the compose file that
> mounts it.

Everything the application talks to, as containers. Nothing here is imported by any package — these
are [Tier 0](../opinions/dependencies.md) dependencies, provided by the deployment and
reached over a protocol the code was going to speak anyway.

[11 · Local Infrastructure](../setup/11-local-infrastructure.md) is the build order and
explains *why* each choice was made. **This is the reference:** what each file does, how each service
works, and how they connect.

**Running it somewhere other than a laptop is [deployment](deployment.md)** — the same nine services
on a VPS, and the order to move them to managed services in when one box stops fitting.

---

## Every file

| File | Read by | Explained in |
|---|---|---|
| `docker-compose.yml` | `docker compose` | [compose](reference/compose.md) |
| `postgres.init.sql` | Postgres, on first boot only | [postgres](reference/postgres.md) |
| *(no file)* | pgBouncer, from compose env | [pgbouncer](reference/pgbouncer.md) |
| `loki.config.yml` | Loki, at startup | [loki](reference/loki.md) |
| `alloy.config.alloy` | Alloy, at startup | [alloy](reference/alloy.md) |
| `logs/` | Alloy, tailed continuously | [alloy](reference/alloy.md) |
| `.env` | `docker compose` | [compose](reference/compose.md#host-ports) |

Redis and Mailpit have no config file — every setting is a command-line flag or a default. See
[redis](reference/redis.md) and [mailpit](reference/mailpit.md).

**The config files are flat on purpose.** Each is mounted as a single file, so a directory per
service would be a path holding one thing. `docs/` is nested because there is genuinely a page's worth
to say about each — which is what earns structure ([Simplicity](../opinions/simplicity.md)).

This is the opposite answer from the one `packages/infrastructure/src/` gives, and the difference is
what each directory holds. There, ClickHouse and Loki each got a folder, because each is several
TypeScript modules and the folder is the unit of "what does this package depend on". Here, each is
one mounted file — and a `clickhouse/` folder holding that one file would state nothing
the ClickHouse schema does not. **Structure is earned by contents, not by symmetry with another
directory.**

---

## How the services connect

Compose creates one bridge network, `lite_default`, and joins every container to it. Inside that
network **a container reaches another by its service name** — Docker's embedded DNS resolves `loki`,
`minio`, `postgres` and so on to the container's address.

```
                    ┌──────────────────────────── host ────────────────────────────┐
                    │                                                              │
   pnpm dev ────────┼──→ :5432 postgres      :6379 redis-cache   :6380 redis-queue │
   (apps on host)   │    :9000 minio (S3)    :3100 loki (query API)                │
                    │                                                              │
                    └──────────────────────────────────────────────────────────────┘
                                              │
   ══════════════════════════ lite_default (bridge) ══════════════════════════════════

     ┌──────────┐   ┌─────────────┐  ┌─────────────┐   ┌───────┐
     │ postgres │   │ redis-cache │  │ redis-queue │   │ minio │
     └────┬─────┘   └─────────────┘  └─────────────┘   └───┬───┘
          │                                                │
          │                                      chunks +  │  bucket `loki`
          │                                       index    │
          │                                                │
                            ┌──────┐  ────────────────────────┘
     query_range ──────────→│ loki │
            :3100           └──▲───┘
                             │ push  loki:3100/loki/api/v1/push
                          ┌──┴────┐
                          │ alloy │──── reads /var/run/docker.sock (every container's stdout)
                          └───────┘──── tails /var/log/app/*.log  (= infra/logs/)
```

**Four things to take from that picture.**

**Nothing connects to the applications.** Traffic runs the other way: the apps dial Postgres, Redis
and MinIO from the host, and Alloy *reads* their output rather than being told anything. That is what
makes the log platform swappable — see [alloy](reference/alloy.md).

**MinIO has two unrelated consumers.** The application stores uploads in the `ratchet` bucket; Loki
stores its chunks and index in the `loki` bucket. They share a server and nothing else
([minio](reference/minio.md)).

**No container in this stack reads the logs back, and none will.** Loki is storage plus a
`query_range` HTTP API; the reader is application code —
[`LokiLogReader`](../../packages/infrastructure/docs/reference/loki.md), built when `LOKI_URL` is
set — because the surface that matters is the super-admin dashboard, which already knows what an
organization is. Grafana used to fill this slot and was removed deliberately: two consoles for one
operator, and the query that mattered was the one it could not express
([compose](reference/compose.md#why-there-is-no-log-ui)).

`docker compose logs` and curl against the API stay the break-glass path regardless
([loki](reference/loki.md)) — a log query that needs the application running is no use during the
incident where the application is down.

**Only Alloy touches the Docker socket**, read-only, and only to read container stdout.

### Ports: inside versus outside

Two numbers per service, and confusing them is the usual source of "connection refused".

| Service | Inside the network | From the host |
|---|---|---|
| postgres | `postgres:5432` | `localhost:25432` — **direct**, `DATABASE_DIRECT_URL` |
| pgbouncer | `pgbouncer:5432` | `localhost:26432` — **pooled**, `DATABASE_URL` |
| redis-cache | `redis-cache:6379` | `localhost:26379` |
| redis-queue | `redis-queue:6379` | `localhost:26380` |
| mailpit | `mailpit:1025` | `localhost:21025`, UI `:8025` |
| minio | `minio:9000` | `localhost:29000`, console `:9001` |
| loki | `loki:3100` | `localhost:23100` |
| alloy | `alloy:12345` | `localhost:12345` |
| clickhouse | `clickhouse:8123` | `localhost:28123`, native `:9002` |

**Both Redis instances listen on 6379 inside.** They are different containers, so there is no
collision; only the host mapping differs. `redis-queue:6380` from inside the network is wrong and
will refuse.

ClickHouse's native port maps to 9002 because MinIO owns 9000.

---

## Startup order

Only two dependencies are declared, and both are real:

```
minio ──healthy──→ minio-init ──completed──→ loki ──healthy──→ alloy
```

Loki cannot start until its bucket exists; Alloy has nowhere to push until Loki accepts writes.
Everything else starts in parallel — Postgres, Redis and MinIO have no dependencies on each other.

**`minio-init` is a one-shot container.** It creates both buckets and exits, so `exited (0)` in
`docker compose ps` is success. Without it the first upload fails with `NoSuchBucket` and everyone
goes looking for a code bug.

---

## What flows where

| Data | From | To | Durable? |
|---|---|---|---|
| Domain rows, audit trail | use-cases | Postgres | **yes** — the source of truth |
| Uploaded files | `StorageGateway` | MinIO `ratchet` | **yes** — a second source of truth |
| Outbound mail | `SmtpEmailSender` | mailpit *(delivered nowhere)* | no — in memory, cleared on restart |
| Capability and session cache | `CacheStore` | redis-cache | no — rebuilt from Postgres |
| Queued jobs | `QueuePublisher` | redis-queue | **yes** — derived from nothing |
| Diagnostic log lines | `JsonLogger` → stdout | Alloy → Loki → MinIO `loki` | no — 30 days, lossy |
| Analytics aggregates | worker, replaying `activity_log` | ClickHouse *(stopped by default)* | no — replayable |

The rule behind that column is [Data and scale](../opinions/data-and-scale.md): **Postgres
owns anything a transaction depends on or a user reads immediately after writing; everything else is
a derived store behind a port.**

---

## Running it

```bash
pnpm infra:up              # four stores + observability     ← the normal command
pnpm infra:core            # four stores only
pnpm infra:up:analytics    # the above, plus ClickHouse
pnpm infra:down            # stop everything, keep volumes
pnpm infra:reset           # stop everything, destroy volumes
pnpm infra:logs            # tail every service
```

| Profile | Services | Default |
|---|---|---|
| *(none)* | `postgres`, `pgbouncer`, `redis-cache`, `redis-queue`, `mailpit`, `minio`, `minio-init` | always |
| `observability` | `loki`, `alloy` | **on** — the diagnostic stream is live today |
| `analytics` | `clickhouse` | **off** — see [clickhouse](reference/clickhouse.md) |

**Starting the container and feeding it are two separate switches.** `pnpm infra:up:analytics` runs
ClickHouse; `CLICKHOUSE_URL` in `.env` is what makes the application build a projector and the worker
register the projection and reconciliation schedules. Both are off by default, and the adapters are
written either way — a folder in `packages/infrastructure/src/` means the seam is implemented, not
that the store is running.

> `down`, `reset` and `logs` pass `--profile "*"`. Compose only acts on profiles it was given, so
> without it a reset leaves ClickHouse running and `logs` omits it from the output you are reading to
> debug it.

**Credentials are `ratchet` / `ratchet` everywhere except MinIO**, which is `ratchet` /
`ratchetsecret`. They are hard-coded on purpose: this stack holds nothing worth protecting, and a
scratch database behind a secret is a scratch database nobody can debug.

---

## Checking the whole stack

```bash
docker compose -f infra/docker-compose.yml ps
```

Seven `healthy`, `minio-init` `exited (0)`, no `clickhouse`.

```bash
# every service is being collected — one entry per container
curl -s -G http://localhost:23100/loki/api/v1/label/app/values | jq -r '.data[]' | sort
```

Per-service checks are on each reference page. The most common failures across all of them:

| Symptom | Usually |
|---|---|
| `connection refused` from inside a container | Used the host port instead of the container port |
| Alloy healthy, no logs in Loki | Project-name filter mismatch — [alloy](reference/alloy.md) |
| Loki unhealthy on first boot | Waiting on `minio-init`; give it the twenty retries |
| A fifth label appears | Loki or a source component invented it — [alloy](reference/alloy.md) |
| ClickHouse table "missing" | It is in `default`, not `ratchet` — [clickhouse](reference/clickhouse.md) |
| Port already allocated | Something else owns it — [compose](reference/compose.md#host-ports) |
