---
title: infra
description: Five containers the application dials and nothing imports — what this directory holds, what each service publishes, and the two conditions a new one has to clear.
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
├── docker-compose.yml      → five services, no profiles, one bridge network
├── postgres.init.sql       → vector, pg_trgm, uuid-ossp — run on first boot only
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

A log platform that only *receives* stdout would clear both and still get no folder in
`packages/infrastructure/src/`. A folder appears there only once something reads back from it over
an API ([Folders](../../docs/opinions/folders.md)). Lite runs no log platform — logs are JSON on
stdout. Adding one is [logs](../../docs/scale/logs.md).

---

## What each service publishes

The surface is a host address and a protocol. Everything else about a service — how it is
configured, what breaks, what to check — is its reference page.

| Service | From the host | Spoken by |
|---|---|---|
| [postgres](../../docs/infra/reference/postgres.md) | `localhost:25432` | `drizzle-orm` + `pg` |
| [redis](../../docs/infra/reference/redis.md) | `localhost:26379` | `CacheStore`, `QueuePublisher`, BullMQ |
| [mailpit](../../docs/infra/reference/mailpit.md) | `localhost:21025`, UI `:28025` | `SmtpEmailSender` |
| [minio](../../docs/infra/reference/minio.md) | `localhost:29000`, console `:29001` | `StorageGateway`, AWS SDK |
| [minio-init](../../docs/infra/reference/minio.md) | — | nothing; creates the bucket and exits |

Two of those rows are worth a sentence, because each looks like a mistake:

- **One Redis for the cache and the queue.** A cache you can flush and a queue whose loss is data
  loss have opposite rules. The queue's rules win: `noeviction` and durable AOF, with a TTL on every
  cache key. The two URLs stay separate, so splitting later is an `.env` change —
  [split-redis](../../docs/scale/split-redis.md). [Data and
  scale](../../docs/opinions/data-and-scale.md) is why.
- **`minio-init` reads `exited (0)`, and that is success.** It is a one-shot that creates the
  `ratchet` bucket; without it the first upload fails with `NoSuchBucket` and everyone goes looking
  for a code bug.

---

## Running it

```bash
pnpm infra:up              # all five services   ← the normal command
pnpm infra:core            # the same thing — kept as an alias
pnpm infra:down            # stop everything, keep volumes
pnpm infra:reset           # stop everything, destroy volumes
```

There are no profiles. `down`, `reset` and `logs` still pass `--profile "*"`, so a profiled service
added later is not left running by a reset.

```bash
docker compose -f infra/docker-compose.yml ps
```

`postgres`, `redis` and `mailpit` `healthy`, `minio` `running`, `minio-init` `exited (0)`. What to do when that is not what you
see is [`docs/infra/`](../../docs/infra/index.md#checking-the-whole-stack).

---

## See also

- [`docs/infra/`](../../docs/infra/index.md) — the stack reference: how the services reach each
  other, what flows where, and the per-file pages this page links to.
  [deployment](../../docs/infra/deployment.md) is the same services on a rented box.
- [Build order · 11 · Local Infrastructure](../../docs/setup/11-local-infrastructure.md) — how it
  was built, and why each choice was made.
- [`@loadbearing/infrastructure`](../../packages/infrastructure/docs/index.md) — the adapters that
  dial these ports, one folder per vendor.
- [Data and scale](../../docs/opinions/data-and-scale.md) — which store owns what.
- [`docs/scale/`](../../docs/scale/index.md) — porting back what lite cut: a pooler, a replica,
  split Redis, shard nodes, logs, analytics.
