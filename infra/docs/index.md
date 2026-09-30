---
title: infra
description: Nine containers the application dials and nothing imports — what this directory holds, what each service publishes, and the two conditions a new one has to clear.
---

# `infra/`

Below the bottom of the dependency graph, which is why it is not a package. Nothing in `packages/`
or `apps/` imports anything here and nothing ever will — these are
[Tier 0](../../docs/opinions/dependencies.md) dependencies, provided by the deployment and reached
over a protocol the code was going to speak anyway. The boundary is the protocol itself: Postgres is
reached over the wire format `pg` speaks, so the seam already exists and this directory only decides
what is listening on the other end of it.

That is also the whole argument for why the local stack is real containers rather than in-process
fakes. A filesystem stand-in for S3 means the S3 code path is first executed on the day you deploy.

| | |
| --- | --- |
| **Directory** | `infra/` — not a package, no `package.json`, nothing to publish |
| **Entrypoint** | `docker-compose.yml`, always via `-f infra/docker-compose.yml` |
| **Depends on** | Docker, and the `.env` at the repository root |
| **Used by** | `pnpm dev`, `apps/web`, `apps/worker` — over TCP, never by import |
| **Environment** | development only; the production analogue is [deployment](../../docs/infra/deployment.md) |
| **Build** | none — `pnpm infra:up` pulls images and starts them |

```
infra/
├── docker-compose.yml      → nine services, three profiles, one bridge network
├── postgres.init.sql       → vector, pg_trgm, uuid-ossp — run on first boot only
├── loki.config.yml         → single-binary Loki, chunks and index into MinIO
├── alloy.config.alloy      → docker stdout + infra/logs/ → Loki, four labels
├── logs/                   → what Alloy tails; .gitkeep only
└── docs/                   → this page
```

---

## What belongs here

Two conditions, both required:

1. **The application reaches it over a protocol, not an import.** If adding it means a `.ts` file
   in this directory, it is not infrastructure — it is a package, and the adapter belongs in
   `packages/infrastructure/src/<vendor>/`.
2. **A managed service replaces it in production without a code change.** The container is a local
   approximation of something you will eventually rent. If nothing you could rent has the same
   protocol, the container is a dependency the architecture cannot get out of later.

**The second condition is the one that gets skipped**, and skipping it is how a local convenience
becomes a permanent one. MinIO is here rather than a filesystem adapter precisely because it clears
it: the AWS SDK talks to MinIO unchanged, so the code path exercised in development is the code path
that runs in production.

A log platform that only *receives* stdout clears both and still gets no folder in
`packages/infrastructure/src/` — until something reads back from it over an API, which is why
`loki/` exists there and holds a reader and no writer
([Folders](../../docs/opinions/folders.md)).

---

## What each service publishes

The surface is a host address and a protocol. Everything else about a service — how it is
configured, what breaks, what to check — is its reference page.

| Service | From the host | Spoken by | Profile |
|---|---|---|---|
| [postgres](../../docs/infra/reference/postgres.md) | `localhost:25432` | `drizzle-orm` + `pg` | always |
| [redis-cache](../../docs/infra/reference/redis.md) | `localhost:26379` | `CacheStore` | always |
| [redis-queue](../../docs/infra/reference/redis.md) | `localhost:26380` | `QueuePublisher`, BullMQ | always |
| [mailpit](../../docs/infra/reference/mailpit.md) | `localhost:21025`, UI `:8025` | `SmtpEmailSender` | always |
| [minio](../../docs/infra/reference/minio.md) | `localhost:29000`, console `:9001` | `StorageGateway`, AWS SDK | always |
| [minio-init](../../docs/infra/reference/minio.md) | — | nothing; creates buckets and exits | always |
| [loki](../../docs/infra/reference/loki.md) | `localhost:23100` | `LokiLogReader`, when `LOKI_URL` is set | `observability` |
| [alloy](../../docs/infra/reference/alloy.md) | `localhost:12345` | nothing — it reads, it is not called | `observability` |
| [clickhouse](../../docs/infra/reference/clickhouse.md) | `localhost:28123`, native `:9002` | the worker's projector, when `CLICKHOUSE_URL` is set | `analytics` |

Three of those rows are worth a sentence, because each looks like a mistake:

- **Two Redis containers**, and they differ only in the host port — a cache you can flush at any
  moment and a queue whose loss is data loss have opposite operational rules. [Data and
  scale](../../docs/opinions/data-and-scale.md) is why.
- **`minio-init` reads `exited (0)`, and that is success.** It is a one-shot that creates both
  buckets; without it the first upload fails with `NoSuchBucket` and everyone goes looking for a
  code bug.
- **Nothing dials Alloy.** It reads the Docker socket and `logs/`, so the log platform is swappable
  by deleting a container rather than by editing application code.

**Starting a container and feeding it are separate switches.** `pnpm infra:up:analytics` runs
ClickHouse; `CLICKHOUSE_URL` in `.env` is what makes the application build a projector. A folder in
`packages/infrastructure/src/` means the seam is implemented, not that the store is running.

---

## Running it

```bash
pnpm infra:up              # the four stores + observability     ← the normal command
pnpm infra:core            # the four stores only
pnpm infra:up:analytics    # the above, plus ClickHouse
pnpm infra:down            # stop everything, keep volumes
pnpm infra:reset           # stop everything, destroy volumes
```

`down`, `reset` and `logs` pass `--profile "*"`, because compose only acts on profiles it was
given — without it a reset leaves ClickHouse running.

```bash
docker compose -f infra/docker-compose.yml ps
```

Seven `healthy`, `minio-init` `exited (0)`, no `clickhouse`. What to do when that is not what you
see is [`docs/infra/`](../../docs/infra/index.md#checking-the-whole-stack).

---

## See also

- [`docs/infra/`](../../docs/infra/index.md) — the stack reference: how the services reach each
  other, what flows where, and the per-file pages this page links to.
  [deployment](../../docs/infra/deployment.md) is the same nine services on a rented box.
- [Build order · 11 · Local Infrastructure](../../docs/setup/11-local-infrastructure.md) — how it
  was built, and why each choice was made.
- [`@loadbearing/infrastructure`](../../packages/infrastructure/docs/index.md) — the adapters that
  dial these ports, one folder per vendor.
- [Data and scale](../../docs/opinions/data-and-scale.md) — which store owns what, and why
  ClickHouse is written but not started.
