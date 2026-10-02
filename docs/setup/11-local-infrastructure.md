# 11 · Local Infrastructure

> Postgres 17 with pgvector, one Redis, MinIO as the S3 stand-in, and Mailpit as the mail stand-in. One command.

**Delivers:** A running local stack that `infrastructure` and `auth` can both connect to.

**Prerequisite:** [10 · `@loadbearing/contracts`](10-contracts-package.md)

> **[`docs/infra/`](../infra/index.md) is the reference for the stack this step builds.** This page is the build order, walked once; that one is what you consult afterwards when something is wrong.

> **Read [Data and scale](../opinions/data-and-scale.md) before this step.** It is why one Redis here still has two URLs, and it decides the partitioning and tenant column that [13](13-infrastructure-postgres.md) builds on.

---

## Step 11.1 — The compose file

**`infra/docker-compose.yml`**, with its comments trimmed. The file is the source; this copy is for reading.

```yaml
name: lite

services:
  postgres:
    image: pgvector/pgvector:pg17
    restart: unless-stopped
    command:
      [
        "postgres",
        "-c", "shared_preload_libraries=pg_stat_statements",
        "-c", "track_io_timing=on",
        "-c", "max_connections=200",
        "-c", "max_locks_per_transaction=1024",
      ]
    environment:
      POSTGRES_USER: ratchet
      POSTGRES_PASSWORD: ratchet
      POSTGRES_DB: ratchet
    ports: ["${POSTGRES_PORT:-45432}:5432"]
    volumes:
      - pgdata:/var/lib/postgresql/data
      - ./postgres.init.sql:/docker-entrypoint-initdb.d/01-extensions.sql:ro
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ratchet -d ratchet"]
      interval: 5s
      timeout: 3s
      retries: 10

  # One instance for the cache, the queue and realtime. Durable, and never evicts.
  redis:
    image: redis:7-alpine
    restart: unless-stopped
    command: ["redis-server", "--appendonly", "yes", "--maxmemory-policy", "noeviction"]
    ports: ["${REDIS_PORT:-46379}:6379"]
    volumes:
      - redisdata:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 3s
      retries: 10

  mailpit:
    image: axllent/mailpit:latest
    restart: unless-stopped
    ports:
      - "${SMTP_PORT:-41025}:1025"
      - "${MAILPIT_UI_PORT:-48025}:8025"
    healthcheck:
      test: ["CMD", "/mailpit", "readyz"]
      interval: 10s
      timeout: 3s
      retries: 10

  minio:
    image: coollabsio/minio:RELEASE.2025-10-15T17-29-55Z
    restart: unless-stopped
    command: server /data --console-address ":9001"
    environment:
      MINIO_ROOT_USER: ratchet
      MINIO_ROOT_PASSWORD: ratchetsecret
    ports: ["${S3_PORT:-49000}:9000", "${MINIO_CONSOLE_PORT:-49001}:9001"]
    volumes:
      - miniodata:/data

  minio-init:
    image: bitnamilegacy/minio-client:latest
    restart: "no"
    depends_on: [minio]
    environment:
      MC_CONFIG_DIR: /tmp/.mc
    entrypoint: >
      /bin/sh -c "
      until mc alias set local http://minio:9000 ratchet ratchetsecret; do sleep 2; done &&
      mc mb --ignore-existing local/ratchet &&
      mc anonymous set none local/ratchet &&
      echo 'buckets ready'
      "

volumes:
  pgdata:
  redisdata:
  miniodata:
```

Five containers. Four stay up, and `minio-init` runs once and exits. There are no profiles: `pnpm infra:up` starts all of it.

> **Every host port is overridable, and every container port is not.** `${MINIO_CONSOLE_PORT:-49001}:9001`
> keeps the documented default while letting one developer move it. Port collisions on a developer
> machine are not hypothetical — this stack met one on the first run, where `9001` was already held
> by an unrelated tool, and later met five at once against two other projects. Hence the `4` prefix
> on every published port: Postgres on `45432`, Redis on `46379`.
>
> **The override goes in the root `.env`, which is the only env file.** Compose reads it because
> `pnpm infra:up` runs `tooling/scripts/compose.mjs`, which passes `--env-file` when that file is
> there. Compose's own default would be `infra/.env`, beside the compose file, and that is how the
> stack and the applications once disagreed about where Postgres was.
>
> ```ini
> # .env — the port and the URLs that dial it are edited together
> POSTGRES_PORT=45432
> DATABASE_URL=postgres://ratchet:ratchet@localhost:45432/ratchet
> DATABASE_DIRECT_URL=postgres://ratchet:ratchet@localhost:45432/ratchet
> ```
>
> `check:architecture` §27 fails the build when a `*_PORT` and its URL disagree. The container-side
> port never changes, so nothing inside the network has to know.

### Why each choice

**`pgvector/pgvector:pg17`** is stock Postgres 17 with the vector extension available to enable. Using the official image and installing pgvector yourself works, but pins you to building an image on every developer machine and every CI runner. Postgres 17 rather than 16 for the improved `VACUUM` memory behaviour, which matters on the activity log more than anywhere else. The real answer for that table is partitioning by tenant and by month, which [13](13-infrastructure-postgres.md) sets up in the baseline migration.

**The `command` flags are measurements and headroom, not tuning.** `pg_stat_statements` and `track_io_timing` answer "which query" before any scaling move. `max_locks_per_transaction=1024` is raised because every tenant is a set of partitions. A statement the planner cannot prune by tenant locks every leaf, and the default of 64 runs out long before the tenant count gets interesting. The full argument is in [reference/partitions](../../packages/infrastructure/docs/reference/partitions.md).

**Two database URLs, one server.** `DATABASE_URL` and `DATABASE_DIRECT_URL` are the same server today. The second name is kept so that putting a pooler in front is an `.env` and compose change, not a code change. See [pgBouncer](../scale/pgbouncer.md).

**One Redis container, and it never evicts.** Redis does three jobs here: the cache, the BullMQ queue, and realtime pub/sub. The cache rebuilds from Postgres on a miss. A BullMQ job does not. It is work somebody asked for and has not happened yet, and losing it is a gap rather than a delay.

One instance means one eviction policy for both. `allkeys-lru` would silently drop queued jobs under memory pressure. So the policy is `noeviction` with AOF, which protects the queue. The cost falls on the cache: nothing may rely on eviction, so **every cache key carries a TTL**.

**The code still reads two names.** `REDIS_CACHE_URL` and `REDIS_QUEUE_URL` both point at `redis://localhost:46379`. `RedisConnection` takes both ([15](15-infrastructure-package.md)), and every consumer asks for the one that matches its job. Splitting the instances later is an `.env` change. See [Split Redis](../scale/split-redis.md).

> **The consequence to keep in mind:** anything reached through `CacheStore` is a cache, never the record. Better Auth's secondary storage is therefore a cache in front of the Postgres `sessions` table — and that is a configuration flag, not a default; see [16](16-auth-package.md). A session missing from Redis must be a read-through, not a sign-out.

**MinIO rather than a filesystem stand-in**, because the code path exercised in development is the code path that runs in production. The AWS SDK talks to MinIO unchanged.

**`minio-init` is a one-shot container**, not a long-running service. It creates the bucket and exits. Without it, every developer's first upload fails with `NoSuchBucket` and they go looking for a code bug. `mc anonymous set none` makes the bucket private, which is the correct default — files are served through presigned URLs from `S3StorageGateway`, never by public path.

**Healthchecks on everything long-running, except MinIO.** The web app and worker both connect on boot; without healthchecks, `pnpm dev` immediately after `pnpm infra:up` races Postgres's startup and fails with a connection error that looks like a config problem. MinIO has none because its image carries neither `mc` nor `curl` to run one. `minio-init` waits on the API itself instead.

**Logs go to stdout, and nothing collects them.** `JsonLogger` writes one JSON line per event, and `docker compose logs` or your terminal is where you read them. There is no log platform in this stack. Bringing one back is infrastructure, not code, because the line format is already right. See [Logs](../scale/logs.md).

> **What this stack does not run:** a pooler, a read replica, a second shard node, a split Redis, an analytics store, or a log platform. The seams for each are in the code. Each store comes back by its page in [`docs/scale/`](../scale/index.md).

---

## Step 11.2 — Enable the extensions

The extensions ship in the image but are not enabled in the database. An init script enables them on a fresh volume.

**`infra/postgres.init.sql`**

```sql
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
```

`vector` for embeddings ([14](14-vector-store.md)). `pg_trgm` for fuzzy text search, which every product ends up wanting. `uuid-ossp` is belt-and-braces — IDs are generated in application code by `Uuid.v7()`, but having the extension available means a data-repair SQL script does not need a round trip through Node. `pg_stat_statements` needs the `shared_preload_libraries` flag from the compose `command`; without it the view is absent.

The baseline migration creates `vector` and `pg_trgm` as well. A managed Postgres runs no init script, so the migration cannot rely on this file.

> **Scripts in `/docker-entrypoint-initdb.d` run only when the data directory is empty.** If your volume already exists, they will not run. Either `pnpm infra:reset` (destroys data) or run the statements by hand — Step 11.3.

---

## Step 11.3 — Start it

```bash
pnpm infra:up
```

```bash
docker compose -f infra/docker-compose.yml ps
```
> `postgres`, `redis` and `mailpit` should read `healthy`. `minio` reads `running`, with no health column, because it has no healthcheck. `minio-init` should read `exited (0)` — that is success, not a failure.

If your Postgres volume predates the init script:

```bash
docker compose -f infra/docker-compose.yml exec postgres psql -U ratchet -d ratchet -c "CREATE EXTENSION IF NOT EXISTS vector;"
```
> Addressing the container by **service name** (`postgres`) rather than a shell-substituted container ID is what makes this work identically in PowerShell and bash.

---

## Step 11.4 — Verify each service

```bash
docker compose -f infra/docker-compose.yml exec postgres psql -U ratchet -d ratchet -c "SELECT extname FROM pg_extension;"
```
> Should list `vector`, `pg_trgm`, `uuid-ossp` and `pg_stat_statements` alongside `plpgsql`.

```bash
docker compose -f infra/docker-compose.yml exec redis redis-cli ping
```
> `PONG`.

```bash
docker compose -f infra/docker-compose.yml exec redis redis-cli config get maxmemory-policy
```
> `noeviction`. Anything else and a full Redis can drop a queued job.

Open `http://localhost:49001` and sign in with `ratchet` / `ratchetsecret`. One bucket should be listed: `ratchet`, empty.

Open `http://localhost:48025`. That is Mailpit's inbox, and it is where every message the kit sends lands in development.

---

## Step 11.5 — Useful operations

```bash
pnpm infra:down
```
> Stops the containers. Volumes survive, so your data is intact.

```bash
pnpm infra:reset
```
> `down -v` — stops containers **and destroys the volumes**. This is the "give me a clean database" button, and it re-runs the init scripts on next start. It is also irreversible, which is why it is a separate script from `infra:down` rather than a flag someone adds by muscle memory.

> **`infra:reset` destroys the Redis volume too**, and that holds the queue — the one thing in the stack that is not rebuildable from Postgres. Locally that is fine; it is scratch data. In any environment with real pending work, clearing the cache and clearing the queue are different operations.

> **Do not `flushall` this Redis.** The cache and the queue share one instance, so a flush meant for the cache also deletes every pending job. To clear cached values, delete by key prefix instead. Once the instances are split ([Split Redis](../scale/split-redis.md)), flushing the cache instance becomes safe again.

```bash
docker compose -f infra/docker-compose.yml logs -f postgres
```
> Raw container stdout, straight from the daemon. This is how you read any service's logs in lite.

---

## What production looks like

The application code does not change between the two columns. These containers are development conveniences, and the configuration in `.env` is what points elsewhere — which works only because the *shape* matches: two Redis URLs locally and two in production, even while both point at one instance.

| Local | Production |
|---|---|
| `pgvector/pgvector:pg17` container | Managed Postgres with the `vector` extension enabled — RDS, Cloud SQL, Neon, Supabase |
| `redis` container | Managed Redis with `noeviction` and AOF — ElastiCache, Upstash, Redis Cloud. Both URLs point at it until [Split Redis](../scale/split-redis.md) |
| MinIO | S3, R2, or any S3-compatible store. Set `S3_FORCE_PATH_STYLE=false` for AWS |
| Mailpit | Any SMTP endpoint — SES, Postmark, Resend, your own relay. One `SMTP_URL`, and `smtps://` for implicit TLS on 465 |
| Logs on stdout | Whatever your host keeps for stdout. A central store is [Logs](../scale/logs.md) |

The full path from here to a rented box, and from there to managed services, is
[`docs/infra/self-hosted.md`](../infra/self-hosted.md) — including the one thing about this
compose file that is safe on a laptop and dangerous on a public IP.

The MinIO row is the reason MinIO is here rather than a local filesystem stand-in: the AWS SDK talks to MinIO unchanged, so the code path exercised in development is the code path that runs in production. A filesystem adapter would mean the S3 path is first executed on the day you deploy.

The `S3_FORCE_PATH_STYLE` switch already exists in `.env.example` from [02](02-repo-skeleton.md). MinIO needs path-style addressing (`endpoint/bucket/key`); AWS wants virtual-host style (`bucket.endpoint/key`). Having it as a config value rather than a code branch is what makes the difference one line in an environment file.

---

## ✅ Gate

- `docker compose -f infra/docker-compose.yml ps` shows `postgres`, `redis` and `mailpit` `healthy`, `minio` running, and `minio-init` `exited (0)`.
- `redis` reports `noeviction`:
  `docker compose -f infra/docker-compose.yml exec redis redis-cli config get maxmemory-policy`
- `SELECT extname FROM pg_extension;` includes `vector` and `pg_stat_statements`.
- The MinIO console at `http://localhost:49001` shows the `ratchet` bucket.
- The Mailpit inbox at `http://localhost:48025` loads.

Do not proceed until this passes.

---

[← `@loadbearing/contracts`](10-contracts-package.md) · [`@loadbearing/application` →](12-application-package.md)
