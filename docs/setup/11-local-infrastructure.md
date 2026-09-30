# 11 · Local Infrastructure

> Postgres 17 with pgvector, two Redis instances, MinIO as the S3 stand-in, Mailpit as the mail stand-in, and the log platform the diagnostic stream ships to. One command.

**Delivers:** A running local stack that `infrastructure` and `auth` can both connect to — plus Loki, so the log stream has somewhere to land.

**Prerequisite:** [10 · `@loadbearing/contracts`](10-contracts-package.md)

> **[`docs/infra/`](../infra/index.md) is the reference for the stack this step builds.** This page is the build order, walked once; that one is what you consult afterwards when something is wrong.

> **Read [Data and scale](../opinions/data-and-scale.md) before this step.** It is why there are two Redis containers here rather than one, and it decides the partitioning and tenant column that [13](13-infrastructure-postgres.md) builds on.

---

## Step 11.1 — The compose file

**`infra/docker-compose.yml`**

```yaml
name: ratchet

services:
  postgres:
    image: pgvector/pgvector:pg17
    restart: unless-stopped
    environment:
      POSTGRES_USER: ratchet
      POSTGRES_PASSWORD: ratchet
      POSTGRES_DB: ratchet
    ports: ["${POSTGRES_PORT:-5432}:5432"]
    volumes:
      - pgdata:/var/lib/postgresql/data
      - ./postgres.init.sql:/docker-entrypoint-initdb.d/01-extensions.sql:ro
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ratchet -d ratchet"]
      interval: 5s
      timeout: 3s
      retries: 10

  redis-cache:
    image: redis:7-alpine
    restart: unless-stopped
    # Evicts under pressure and does not persist. Everything on it is rebuildable
    # from Postgres, so losing it costs a slow minute rather than data.
    command: ["redis-server", "--save", "", "--maxmemory-policy", "allkeys-lru"]
    ports: ["${REDIS_CACHE_PORT:-6379}:6379"]
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 3s
      retries: 10

  redis-queue:
    image: redis:7-alpine
    restart: unless-stopped
    # Never evicts and always persists. A queued job is derived from nothing, so a
    # dropped key here is work that never happens.
    command: ["redis-server", "--appendonly", "yes", "--maxmemory-policy", "noeviction"]
    ports: ["${REDIS_QUEUE_PORT:-6380}:6379"]
    volumes:
      - redisqueuedata:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 3s
      retries: 10

  minio:
    image: coollabsio/minio:RELEASE.2025-10-15T17-29-55Z
    restart: unless-stopped
    command: server /data --console-address ":9001"
    environment:
      MINIO_ROOT_USER: ratchet
      MINIO_ROOT_PASSWORD: ratchetsecret
    ports: ["${S3_PORT:-9000}:9000", "${MINIO_CONSOLE_PORT:-9001}:9001"]
    volumes:
      - miniodata:/data
    healthcheck:
      test: ["CMD", "mc", "ready", "local"]
      interval: 5s
      timeout: 3s
      retries: 10

  minio-init:
    image: bitnamilegacy/minio-client:latest
    depends_on: [minio]
    entrypoint: >
      /bin/sh -c "
      until mc alias set local http://minio:9000 ratchet ratchetsecret; do sleep 2; done &&
      mc mb --ignore-existing local/ratchet &&
      mc mb --ignore-existing local/loki &&
      mc anonymous set none local/ratchet &&
      mc anonymous set none local/loki &&
      echo 'buckets ready'
      "

  # ── observability ─────────────────────────────────────────
  # On by default. The diagnostic stream exists today, so it needs
  # somewhere to go and something to read it with.

  loki:
    image: grafana/loki:3.3.2
    profiles: ["observability"]
    restart: unless-stopped
    command: ["-config.file=/etc/loki/config.yml"]
    ports: ["${LOKI_PORT:-3100}:3100"]
    depends_on:
      minio-init:
        condition: service_completed_successfully
    volumes:
      - ./loki.config.yml:/etc/loki/config.yml:ro
      - lokidata:/loki
    healthcheck:
      test: ["CMD-SHELL", "wget -q -O- http://localhost:3100/ready | grep -q ready"]
      interval: 10s
      timeout: 3s
      retries: 20

  alloy:
    image: grafana/alloy:v1.5.1
    profiles: ["observability"]
    restart: unless-stopped
    command:
      - run
      - --server.http.listen-addr=0.0.0.0:12345
      - /etc/alloy/config.alloy
    ports: ["${ALLOY_PORT:-12345}:12345"]
    depends_on:
      loki:
        condition: service_healthy
    volumes:
      - ./alloy.config.alloy:/etc/alloy/config.alloy:ro
      # Reads container stdout. Read-only, and the only reason this file
      # touches the Docker socket at all.
      - /var/run/docker.sock:/var/run/docker.sock:ro
      # The `pnpm dev | tee` target, for apps running on the host.
      - ./logs:/var/log/app:ro
    healthcheck:
      # The Alloy image ships neither wget nor curl, so the probe is bash's
      # /dev/tcp. It proves Alloy is listening, not that every component loaded —
      # the gate below checks that properly, by asking Loki what arrived.
      test: ["CMD", "bash", "-c", "exec 3<>/dev/tcp/localhost/12345"]
      interval: 10s
      timeout: 3s
      retries: 10

  # ── analytics, opt-in ─────────────────────────────────────
  # Not started by `pnpm infra:up`. Nothing writes to it until the
  # projection consumer exists — see the note below.

  clickhouse:
    image: clickhouse/clickhouse-server:24.12-alpine
    profiles: ["analytics"]
    restart: unless-stopped
    environment:
      CLICKHOUSE_USER: ratchet
      CLICKHOUSE_PASSWORD: ratchet
      CLICKHOUSE_DB: ratchet
      CLICKHOUSE_DEFAULT_ACCESS_MANAGEMENT: 1
    ports: ["${CLICKHOUSE_HTTP_PORT:-8123}:8123", "${CLICKHOUSE_NATIVE_PORT:-9002}:9000"]
    volumes:
      - clickhousedata:/var/lib/clickhouse
    ulimits:
      nofile: { soft: 262144, hard: 262144 }
    healthcheck:
      # 127.0.0.1, not localhost. ClickHouse listens on 0.0.0.0 (IPv4 only) while
      # busybox wget resolves localhost to ::1 first, so the localhost form is
      # refused from inside the container and the service never reports healthy.
      test: ["CMD-SHELL", "wget -q -O- http://127.0.0.1:8123/ping | grep -q Ok"]
      interval: 10s
      timeout: 3s
      retries: 10

volumes:
  pgdata:
  redisqueuedata:
  miniodata:
  lokidata:
  clickhousedata:
```

> The cache has no volume on purpose. A named volume for something explicitly disposable invites someone to treat it as durable.

> **Every host port is overridable, and every container port is not.** `${MINIO_CONSOLE_PORT:-29001}:9001`
> keeps the documented default while letting one developer move it. Port collisions on a developer
> machine are not hypothetical — this stack met one on the first run, where `9001` was already held
> by an unrelated tool, and later met five at once against two other projects. Hence the `1` prefix
> on every published port: Postgres on `25432`, Redis on `26379`.
>
> **The override goes in the root `.env`, which is the only env file.** Compose reads it because
> `pnpm infra:up` runs `tooling/scripts/compose.mjs`, which passes `--env-file` when that file is
> there. Compose's own default would be `infra/.env`, beside the compose file, and that is how the
> stack and the applications once disagreed about where Postgres was.
>
> ```ini
> # .env — the port and the URL that dials it are edited together
> POSTGRES_PORT=25432
> DATABASE_DIRECT_URL=postgres://ratchet:ratchet@localhost:25432/ratchet
> ```
>
> `check:architecture` §27 fails the build when a `*_PORT` and its URL disagree. The container-side
> port never changes, so nothing inside the network has to know.

> **ClickHouse's native port is remapped to 29002.** MinIO already owns the `29000` a `1` prefix would give it, and the collision produces a container that starts, binds nothing useful, and fails at connect time with an error naming neither service.

### Why each choice

**`pgvector/pgvector:pg17`** is stock Postgres 17 with the vector extension available to enable. Using the official image and installing pgvector yourself works, but pins you to building an image on every developer machine and every CI runner. Postgres 17 rather than 16 for the improved `VACUUM` memory behaviour, which matters on the activity log more than anywhere else — though the real answer for that table is monthly partitioning and a retention policy, which [13](13-infrastructure-postgres.md) sets up in the first migration.

**Two Redis containers, because the three jobs Redis does are not equally disposable.** Cache and session storage are cache-aside: both rebuild from Postgres on a miss, so evicting them costs a slow minute. A BullMQ job is derived from nothing — it is work somebody asked for and has not happened yet, and losing it is a gap rather than a delay.

Running one instance forces one eviction policy onto both. `allkeys-lru` silently drops queued jobs under memory pressure; `noeviction` protects the queue but turns a full cache into hard errors on a path that should degrade gracefully. There is no correct single answer, which is the tell that it is two concerns.

**Splitting locally rather than only in production is the same argument that puts MinIO here** instead of a filesystem stand-in: the code path exercised in development is the code path that runs in production. `RedisConnection` takes two URLs ([15](15-infrastructure-package.md)), and a developer who flushes their cache while debugging does not lose the jobs they just enqueued.

> **The consequence to keep in mind:** anything reached through `CacheStore` is on the instance that evicts. Better Auth's secondary storage is therefore a cache in front of the Postgres `sessions` table, never the record — and that is a configuration flag, not a default; see [16](16-auth-package.md). A session that vanishes under LRU must be a read-through, not a sign-out.

**`minio-init` is a one-shot container**, not a long-running service. It creates the bucket and exits. Without it, every developer's first upload fails with `NoSuchBucket` and they go looking for a code bug. `mc anonymous set none` makes the bucket private, which is the correct default — files are served through presigned URLs from `S3StorageGateway`, never by public path.

**Healthchecks on everything long-running.** The web app and worker both connect on boot; without healthchecks, `pnpm dev` immediately after `pnpm infra:up` races Postgres's startup and fails with a connection error that looks like a config problem.

**Loki stores into MinIO, which was already running.** That is the whole argument for a log platform over a log table: retention, search, and level filtering become configuration. `retention_period: 720h` below is literally the thirty-day policy [Data and scale](../opinions/data-and-scale.md) commits to, and there is no migration, no partition, and no cleanup job behind it.

Pointing Loki at MinIO rather than a local volume also means the local topology matches production, where it is S3. One fewer thing that behaves differently on the day you deploy.

**There is no log UI in this stack, deliberately.** Loki is storage and a query API; reading it is
the super admin dashboard's job, and until that exists the fallbacks are `docker compose logs` and
`curl` against Loki's HTTP API (Step 11.7). Grafana used to sit here and was removed: a second
console meant two places to look, and the one query an operator actually needs — *these logs, for
this tenant, joined to that tenant's audit rows* — is one Grafana cannot express, because it has no
idea what an organization is.

**Three profiles, and each split is a decision rather than a convenience.**

`observability` is on by default because the diagnostic stream is not hypothetical — `JsonLogger` exists, `EVENT_CATALOG` exists, and every adapter written from [13](13-infrastructure-postgres.md) onward emits into it. A stream with no sink is a stream nobody checks.

`analytics` is **off** by default because [Data and scale](../opinions/data-and-scale.md) says not to adopt ClickHouse yet, and it means it. Postgres answers every question this kit will ask for years, and nothing in the kit reads an analytics store at all. The container is here so that the day the trigger fires — snapshots stop covering ad-hoc queries — adopting it is `--profile analytics`, `CLICKHOUSE_URL`, and then the reader the dashboard needs, rather than an infrastructure project.

`sharded` is **off** for the same kind of reason, and it arrives later — Phase 22 of `plans/archive/PLAN.md` builds the routing seam without running a second Postgres. `postgres-shard-1` and `pgbouncer-shard-1` are the same image and the same `postgres.init.sql` on their own volume, so a rehearsal applies the identical schema to both. Starting them is `pnpm infra:up:sharded` plus the two commented lines in `.env.example`; nothing else configures a shard, because `shard_assignments` on the catalog names the node one row per tenant.

> **A running ClickHouse with nothing writing to it is worse than no ClickHouse**, because it looks like a decision that was made. Leave it stopped until a projection consumer exists. The same applies to the second node: an empty shard nothing routes to is a machine to pay for and a schema to keep migrated.

---

## Step 11.2 — Enable pgvector

The extension ships in the image but is not enabled in the database. Create an init script so a fresh volume enables it automatically.

**`infra/postgres.init.sql`**

```sql
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
```

`vector` for embeddings ([14](14-vector-store.md)). `pg_trgm` for fuzzy text search, which every product ends up wanting and which is far cheaper to enable now than in a migration later. `uuid-ossp` is belt-and-braces — IDs are generated in application code by `Uuid.v7()`, but having the extension available means a data-repair SQL script does not need a round trip through Node.

> **Scripts in `/docker-entrypoint-initdb.d` run only when the data directory is empty.** If your volume already exists, they will not run. Either `pnpm infra:reset` (destroys data) or run the statements manually — Step 11.3.

---

## Step 11.3 — The log pipeline

Two files. Neither is application code, and no package imports either of them — that is the point of
[Tier 0](../opinions/dependencies.md): the deployment provides the log platform, and `JsonLogger`
never learns it exists.

**`infra/loki.config.yml`**

```yaml
auth_enabled: false

server:
  http_listen_port: 3100
  log_level: warn

common:
  instance_addr: 127.0.0.1
  path_prefix: /loki
  replication_factor: 1
  ring:
    kvstore:
      store: inmemory

  storage:
    s3:
      endpoint: minio:9000
      bucketnames: loki
      access_key_id: ratchet
      secret_access_key: ratchetsecret
      s3forcepathstyle: true
      insecure: true

schema_config:
  configs:
    - from: 2024-01-01
      store: tsdb
      object_store: s3
      schema: v13
      index:
        prefix: index_
        period: 24h

limits_config:
  # The thirty-day policy, as one line.
  retention_period: 720h
  reject_old_samples: true
  reject_old_samples_max_age: 168h
  # A guard against the failure this whole design is about.
  max_label_names_per_series: 8

  # Loki 3.x invents labels unless told not to. Left at their defaults it adds a
  # `service_name` to every stream and a `detected_level` alongside ours — so the
  # label set the Alloy pipeline carefully limits to four arrives as six.
  # Both are off because the pipeline already decides what a label is.
  discover_service_name: []
  discover_log_levels: false

compactor:
  working_directory: /loki/compactor
  delete_request_store: s3
  retention_enabled: true
```

`s3forcepathstyle: true` and `insecure: true` are the MinIO equivalents of `S3_FORCE_PATH_STYLE`
from [02](02-repo-skeleton.md) — same distinction, same reason, and the same two values flip for real
S3.

**`max_label_names_per_series: 8` is a backstop, not the rule.** The rule is the Alloy config below,
which promotes exactly four. This makes a mistake fail loudly at ingest rather than quietly
multiplying streams.

**`infra/alloy.config.alloy`**

```alloy
// Container stdout, every service in the compose file. The filter is not
// optional: `discovery.docker` finds every container on the machine, so without
// it Alloy ingests unrelated projects a developer happens to have running.
discovery.docker "compose" {
  host             = "unix:///var/run/docker.sock"
  refresh_interval = "15s"

  filter {
    name   = "label"
    values = ["com.docker.compose.project=ratchet"]
  }
}

discovery.relabel "compose" {
  targets = discovery.docker.compose.targets

  // The fallback `app`, for the containers that do not emit our JSON. Our own
  // apps overwrite it from the log body in the pipeline below.
  rule {
    source_labels = ["__meta_docker_container_label_com_docker_compose_service"]
    target_label  = "app"
  }
}

loki.source.docker "compose" {
  host       = "unix:///var/run/docker.sock"
  targets    = discovery.relabel.compose.output
  forward_to = [loki.process.stream.receiver]
}

// `pnpm dev` runs on the host, not in a container, so nothing above can see it.
// `pnpm dev | tee infra/logs/dev.log` lands here.
local.file_match "dev" {
  path_targets = [{ __path__ = "/var/log/app/*.log", app = "dev" }]
}

loki.source.file "dev" {
  targets    = local.file_match.dev.targets
  forward_to = [loki.process.stream.receiver]
}

// One pipeline for every source. A stage that cannot parse a line extracts
// nothing and falls through to the next, so the stages compose rather than
// needing a branch per service.
loki.process "stream" {
  forward_to = [loki.write.default.receiver]

  // Our own lines. `app` and `env` are bound onto every one by the container
  // ([17]); `level` and `event` come from the catalog.
  stage.json {
    expressions = {
      app        = "app",
      env        = "env",
      level      = "level",
      event_code = "event",
    }
  }

  // Loki and Alloy emit logfmt with a `level` key. Same extracted key
  // as above, so whichever stage understood the line is the one that wins.
  //
  // Gated by a selector, unlike stage.json: a JSON stage that cannot parse a
  // line fails silently, but stage.logfmt logs an error for every line it does
  // not understand — and Alloy collects its own stdout, so ungated it spends the
  // whole pipeline reporting that Postgres does not speak logfmt.
  stage.match {
    selector = "{app=~\"loki|alloy\"}"

    stage.logfmt {
      mapping = { level = "" }
    }
  }

  // Every line gets `env`, including the third-party containers whose format
  // carries no such field. Set before `stage.labels`, so an app line that
  // carries its own `env` still overrides this.
  stage.static_labels {
    values = { env = "development" }
  }

  // Promote exactly these four. A key nothing extracted is left unset rather
  // than blanked, which is what keeps the fallback `app` from the relabel rule.
  stage.labels {
    values = {
      app        = "",
      env        = "",
      level      = "",
      event_code = "",
    }
  }

  // `loki.source.file` attaches `filename` to every stream it creates, which is
  // a fifth label and one stream per rotated file. Nothing in this config asked
  // for it — which is exactly why the gate queries the live label set rather
  // than trusting a reading of this file.
  stage.label_drop {
    values = ["filename"]
  }
}

loki.write "default" {
  endpoint {
    url = "http://loki:3100/loki/api/v1/push"
  }
}
```

**This file is where the label rule stops being a convention.** Four labels leave here and no others,
and all four are lifted out of the JSON body by name. `traceId`, `organizationId`, `userId` and
`jobId` are never mentioned, so they cannot be promoted by accident — they ride in the log line and
are reached with `| json` at query time.

Adding a `values` entry here is the one edit that can quietly make Loki miserable. It should be as
hard to do casually as adding a row to a catalog, and reviewing this file is how.

### What each service actually gets

Every container in the compose project is collected, but they do not all carry the same labels —
third-party services have never heard of our event catalog, and pretending otherwise would mean a
regex per vendor to maintain.

| Service | `app` | `env` | `level` | `event_code` | Parsed as |
|---|---|---|---|---|---|
| `web`, `worker` (or `dev` via the file tail) | from body | from body | from body | ✅ | our JSON |
| `loki`, `alloy` | service name | static | from body | — | logfmt |
| `postgres`, `redis-cache`, `redis-queue`, `minio`, `clickhouse` | service name | static | — | — | plain text |

**Only our own applications get all four**, which is the intended asymmetry: `event_code` exists
because we have a closed catalog, and Postgres does not.

**Everything gets `app` and `env`**, so `{env="development"}` really does mean the whole stack and
`{app="postgres"}` finds the database. That is what the `stage.static_labels` line buys — without it,
a failed `stage.json` left third-party lines with no `env` at all and any query scoped by environment
silently excluded half the stack.

**Postgres, Redis, MinIO and ClickHouse get no `level`.** Their severities are four different
bespoke formats, and normalising each into our label is a regex per vendor that breaks on their next
release. `{app="postgres"} |= "ERROR"` is the query, and a line-filter over one service's streams is
cheap — this is the case Loki is good at. The `level` label exists for the volume our own code
produces.

> **Alloy collects Alloy.** That is deliberate — you want to see the shipper's own errors — and it
> does not amplify: when Loki is unreachable Alloy retries from its own buffer with backoff rather
> than logging once per dropped line.

> **`refresh_interval = "15s"`** is how long a newly started container waits before its logs appear.
> The default is a minute, which is long enough that a developer restarting one service concludes the
> pipeline is broken.

**All four labels come from the log line rather than from container metadata, and that is a
deliberate reversal.** The obvious design reads `app` from the Compose service name and sets `env` as a static
`external_labels` entry. It works here and stops working the moment the topology changes: on
Kubernetes the container name is a pod name, `web-7d4f9` and `web-2a1c8` are two different values of
what should be one label, and a host-run `pnpm dev` has no container at all.

The application already knows which application it is. `Container` binds `app` and `env` onto every
line it writes ([17](17-composition-container.md)), so one pipeline produces correct labels under
Compose, under Kubernetes, and from a tailed file — and `APP` / `ENV` in `.env.example` are read
rather than decorative.

> **The contract this depends on is asserted in code**, in
> `packages/observability/tests/logger/wire-contract.spec.ts`. That file is the only thing spanning
> `JsonLogger`'s output and this config — no compiler sees both — so renaming the `event` field or
> nesting `level` fails a test here rather than silently producing unlabelled streams in production.

> **`LOG_PRETTY=true` makes this pipeline blind.** The human format is not JSON, `stage.json` drops
> what it cannot parse, and the lines arrive with no labels beyond the target's. That is fine in a
> terminal and wrong anywhere Alloy is reading — which is why the flag exists as config rather than
> as a guess about the environment.

> **Local `pnpm dev` does not ship to Loki by default, and that is deliberate.** The apps run on your
> host; `LOG_PRETTY=true` in a terminal is the normal loop and is better for debugging than a web UI.
> Pipe when you actually want to exercise the pipeline:
>
> ```bash
> pnpm dev | tee infra/logs/dev.log
> ```
>
> `infra/logs/` is gitignored. Everything running *in* Compose is picked up with no extra step.

---

## Step 11.4 — ClickHouse's schema, for later

Only read when you start the `analytics` profile. It exists so the profile is runnable rather than a
stub.

**`upstream:packages/infrastructure/clickhouse-migrations/0000_activity_events.sql`**, applied by `pnpm ch:migrate`

```sql
-- Derived, and rebuildable by replaying the activity log. Nothing here is a
-- source of truth, which is what keeps the swap a performance decision.
--
-- The name is database-qualified on purpose: ClickHouse's entrypoint runs the
-- scripts in this directory against `default`, not against CLICKHOUSE_DB, so an
-- unqualified CREATE succeeds in the wrong place and the table looks missing.
CREATE TABLE IF NOT EXISTS ratchet.activity_events
(
  organization_id UUID,
  occurred_at     DateTime64(3),
  actor_id        String,
  action          LowCardinality(String),
  subject_id      Nullable(UUID),
  payload         String
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(occurred_at)
ORDER BY (organization_id, action, occurred_at)
TTL toDateTime(occurred_at) + INTERVAL 5 YEAR;
```

**`ORDER BY` leads with `organization_id`** for the same reason every Postgres index does: it is the
tenant boundary, and an analytics store that cannot answer a question for one organization cheaply is
not useful.

**`action` is `LowCardinality`** — the ClickHouse equivalent of the label-cardinality argument, one
layer down.

**A five-year TTL, against Postgres's twelve-to-twenty-four months.** That asymmetry is the reason
the analytics store exists: Postgres keeps detail for as long as an operator needs to read a row, and
the column store keeps aggregates for as long as the business needs a trend.

---

## Step 11.5 — Start it

```bash
pnpm infra:up
```

```bash
docker compose -f infra/docker-compose.yml ps
```
> Six services should read `healthy`: postgres, redis-cache, redis-queue, minio, loki, alloy. `minio-init` should read `exited (0)` — that is success, not a failure. `clickhouse` should not be listed at all; it is behind the `analytics` profile.

Loki takes longer to report healthy than the rest, because it waits for `minio-init` to create its bucket. Twenty retries at ten seconds is generous on purpose — a cold image pull on a slow connection is the usual cause, not a misconfiguration.

To start the analytics profile as well, when there is finally something to put in it:

```bash
pnpm infra:up:analytics
```

And the second Postgres, to rehearse the split:

```bash
pnpm infra:up:sharded
```
> Then uncomment `DATABASE_SHARD_1_URL` and `DATABASE_SHARD_1_DIRECT_URL`. `pnpm db:migrate`
> applies the schema to both nodes, and `curl /api/health` reports `database: { "0": true, "1": true }`.

If your Postgres volume predates the init script:

```bash
docker compose -f infra/docker-compose.yml exec postgres psql -U ratchet -d ratchet -c "CREATE EXTENSION IF NOT EXISTS vector;"
```
> Addressing the container by **service name** (`postgres`) rather than a shell-substituted container ID is what makes this work identically in PowerShell and bash.

---

## Step 11.6 — Verify each service

```bash
docker compose -f infra/docker-compose.yml exec postgres psql -U ratchet -d ratchet -c "SELECT extname FROM pg_extension;"
```
> Should list `vector`, `pg_trgm`, and `uuid-ossp` alongside `plpgsql`.

```bash
docker compose -f infra/docker-compose.yml exec redis-cache redis-cli ping
```

```bash
docker compose -f infra/docker-compose.yml exec redis-queue redis-cli ping
```
> `PONG`.

Open `http://localhost:29001` and sign in with `ratchet` / `ratchetsecret`. Two buckets should be listed: `ratchet`, empty, and `loki`, which fills as soon as anything logs.

```bash
curl -s http://localhost:23100/ready
```
> `ready`. Loki is accepting writes.

```bash
curl -s -G http://localhost:23100/loki/api/v1/labels | jq -r '.data[]'
```
> Once anything has logged, this is the whole point of the exercise: it should print `app`, `env`, `event_code`, `level` — **and nothing else**. A fifth label here means the Alloy pipeline promoted something it should not have, and it is far cheaper to notice now than at a hundred thousand streams.

There is no log UI to open. Query Loki over HTTP instead — the same `query_range` endpoint the super
admin dashboard will call:

```bash
curl -s -G http://localhost:23100/loki/api/v1/query_range   --data-urlencode 'query={app="postgres"} | json'   --data-urlencode "start=$(date -d '15 minutes ago' +%s)000000000"   | jq -r '.data.result[].values[][1]'
```
> Worth keeping as a shell alias. It is the break-glass path for as long as the dashboard is the
> only reader, and it stays the break-glass path afterwards — a log query that depends on the app
> being up is no use during the incident where the app is down.

---

## Step 11.7 — Useful operations

```bash
pnpm infra:down
```
> Stops the containers. Volumes survive, so your data is intact.

```bash
pnpm infra:reset
```
> `down -v --profile "*"` — stops containers **and destroys the volumes**. This is the "give me a clean database" button, and it re-runs the init scripts on next start. It is also irreversible, which is why it is a separate script from `infra:down` rather than a flag someone adds by muscle memory.

> **`--profile "*"` on both `down` and `reset` is not decoration.** `docker compose down` only stops services in the profiles it was given, so without it a `pnpm infra:reset` leaves ClickHouse running and its volume intact — and the next `ps` shows a container the developer does not remember starting.

> **`infra:reset` destroys the queue volume too**, which is the one thing in the stack that is not rebuildable from Postgres. Locally that is fine — it is a scratch database. The habit is what matters: in any environment with real pending work, clearing the cache and clearing the queue are different operations, and the split is what makes it possible to do one without the other.

```bash
docker compose -f infra/docker-compose.yml exec redis-cache redis-cli flushall
```
> The cache is disposable by construction, so this is a safe debugging move — everything on it reads through to Postgres on the next miss. Running the same command against `redis-queue` deletes work.

```bash
docker compose -f infra/docker-compose.yml logs -f postgres
```
> Raw container stdout, straight from the daemon. The shortest path when Loki, Alloy, or the
> dashboard reading them is itself the thing that is broken.

```bash
pnpm dev | tee infra/logs/dev.log
```
> Ships host-run app logs to Loki as well as your terminal. Optional — `LOG_PRETTY=true` and reading the terminal is the normal loop.

---

## What production looks like

The application code does not change between the two columns. These containers are development conveniences, and the configuration in `.env` is what points elsewhere — which works only because the *shape* matches: two Redis URLs locally and two in production, not one that becomes two on deployment day.

| Local | Production |
|---|---|
| `pgvector/pgvector:pg17` container | Managed Postgres with the `vector` extension enabled — RDS, Cloud SQL, Neon, Supabase |
| `redis-cache` container | Managed Redis with `allkeys-lru` — ElastiCache, Upstash, Redis Cloud. Sized for working set; no persistence needed |
| `redis-queue` container | A **separate** managed Redis with `noeviction` and AOF. Never the same instance as the cache |
| MinIO | S3, R2, or any S3-compatible store. Set `S3_FORCE_PATH_STYLE=false` for AWS |
| Mailpit | Any SMTP endpoint — SES, Postmark, Resend, your own relay. One `SMTP_URL`, and `smtps://` for implicit TLS on 465 |
| `loki` + `alloy` containers | Self-hosted Loki with S3 storage, or Grafana Cloud — the same config, a different `url`. Alloy runs as a DaemonSet on Kubernetes |
| `clickhouse` container, stopped | ClickHouse Cloud or a managed instance — and only once the trigger in [Data and scale](../opinions/data-and-scale.md) §5 has actually fired |

The full path from here to a rented box, and from there to managed services, is
[`docs/infra/deployment.md`](../infra/deployment.md) — including the one thing about this
compose file that is safe on a laptop and dangerous on a public IP.

That last row is the reason MinIO is here rather than a local filesystem stand-in: the AWS SDK talks to MinIO unchanged, so the code path exercised in development is the code path that runs in production. A filesystem adapter would mean the S3 path is first executed on the day you deploy.

The `S3_FORCE_PATH_STYLE` switch already exists in `.env.example` from [02](02-repo-skeleton.md). MinIO needs path-style addressing (`endpoint/bucket/key`); AWS wants virtual-host style (`bucket.endpoint/key`). Having it as a config value rather than a code branch is what makes the difference one line in an environment file.

---

## ✅ Gate

- `docker compose -f infra/docker-compose.yml ps` shows postgres, redis-cache, redis-queue, minio, loki, and alloy all `healthy`, and does **not** list clickhouse.
- `redis-cache` reports `maxmemory_policy:allkeys-lru` and `redis-queue` reports `noeviction`:
  `docker compose -f infra/docker-compose.yml exec redis-queue redis-cli config get maxmemory-policy`
- `SELECT extname FROM pg_extension;` includes `vector`.
- The MinIO console at `http://localhost:29001` shows `ratchet` and `loki` buckets.
- `curl -s http://localhost:23100/ready` returns `ready`.
- **The label set is exactly four.** Query a *fresh* window and inspect real streams, not the global label list — the global list includes streams from before any config change and will show ghosts:
  ```bash
  curl -s -G http://localhost:23100/loki/api/v1/series     --data-urlencode "start=$(($(date +%s)-60))000000000"     --data-urlencode 'match[]={app=~".+"}'
  ```
  Every stream must carry only `app`, `env`, `level`, `event_code`.

  > **Check this against the running system, never by reading the config.** Two of the three label
  > leaks found while writing this step came from components that were never named in
  > `config.alloy`: Loki 3.x invents `service_name` unless `discover_service_name` is emptied, and
  > `loki.source.file` attaches `filename` until a `stage.label_drop` removes it. A config review
  > cannot see either one.
- **Every service is being collected.** This lists one entry per compose service, not just the ones that emit JSON:
  ```bash
  curl -s -G http://localhost:23100/loki/api/v1/label/app/values | jq -r '.data[]' | sort
  ```
  Expect `alloy`, `loki`, `minio`, `postgres`, `redis-cache`, `redis-queue`. A missing entry means that container has logged nothing yet, not that it is being skipped — restart it and look again.
- **Nothing from other projects leaked in.** No value above belongs to a container outside this compose file. If one does, the `com.docker.compose.project` filter is wrong.
- Loki answers a `query_range` curl with lines from at least one container.
- `pnpm infra:up:analytics` starts clickhouse, `curl -s http://localhost:28123/ping` returns `Ok`, and the table is in the **`ratchet`** database rather than `default`:
  ```bash
  curl -s "http://localhost:28123/?user=ratchet&password=ratchet"     --data-binary "SELECT database, name FROM system.tables WHERE name = 'activity_events' FORMAT TSV"
  ```
  Then `docker compose -f infra/docker-compose.yml --profile analytics stop clickhouse` — nothing writes to it yet.

Do not proceed until this passes.

---

[← `@loadbearing/contracts`](10-contracts-package.md) · [`@loadbearing/application` →](12-application-package.md)
