---
title: deployment
description: One VPS now, managed services later — what changes, what never changes, and the order to move things in when it stops fitting on one box.
---

# Deployment

The same nine services, on a machine you rent. Then, service by service, on machines somebody else
operates.

**The application code does not change between any of the stages on this page.** Every store is
behind a port ([Dependencies](../opinions/dependencies.md)), every credential is a value in
`.env`, and no package reads `process.env` at all. That is what makes each move below a config change
rather than a migration — and it is the whole return on the architecture.

> **Nothing on this page has been executed.** The local stack in [index](index.md) is verified
> against a running system; this is design, and the first real deployment will find things it got
> wrong. Treat the commands as a starting point rather than a transcript.

---

## Before anything else: the ports are wide open

The compose file publishes every service on **all interfaces**:

```
postgres      0.0.0.0:5432->5432/tcp
redis-cache   0.0.0.0:6379->6379/tcp     ← no password
redis-queue   0.0.0.0:6380->6379/tcp     ← no password
minio         0.0.0.0:9000->9000/tcp
loki          0.0.0.0:3100->3100/tcp     ← no auth, accepts writes
```

On a laptop behind NAT that is convenient and harmless. **On a VPS with a public IP it is a database,
two unauthenticated caches, an object store and an unauthenticated log API on the open internet.** Scanners find
port 5432 in minutes.

> [!CAUTION]
> **A firewall does not fix this by itself.** Docker writes its own iptables rules into the
> `DOCKER-USER` chain, which is evaluated *before* UFW's chains. `ufw deny 5432` looks like it
> worked, reports as active, and the port stays reachable. This surprises people who have done
> everything right.

**The fix is to stop publishing, not to filter.** Services that only other containers use need no
`ports:` entry at all — they are already reachable on the bridge network by service name. The
production overlay below removes every publish except the reverse proxy's.

Where you genuinely need host access — `psql` from your laptop — bind to loopback and reach it
through an SSH tunnel:

```yaml
ports: ["127.0.0.1:25432:5432"]
```

```bash
ssh -L 5432:localhost:25432 you@vps    # then psql against localhost:5432
```

---

## Phase 1 — one VPS

Everything on one box, Compose, no orchestrator. This is the correct shape for a long time, and
[Data and scale](../opinions/data-and-scale.md) is explicit that most products never outgrow
it.

### Sizing

| | vCPU | RAM | Disk |
|---|---|---|---|
| Minimum to run | 2 | 4 GB | 40 GB SSD |
| Comfortable | 4 | 8 GB | 80 GB SSD |

Postgres and Loki want the memory. Disk is dominated by `pgdata` and MinIO — the `loki` bucket is
bounded by the thirty-day retention, which is the point of having it.

**These numbers assume ClickHouse is not running, which it is not.** It is sized separately below,
because it does not fit on this box.

### The production overlay

Keep `docker-compose.yml` as the base and add a second file that only says what differs. Compose
merges them left to right:

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```

**`infra/docker-compose.prod.yml`** — illustrative; write it on the host, it is not in the repository.

```yaml
services:
  # ── stop publishing anything but the proxy ────────────────
  postgres:
    ports: !override []
    environment:
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?required}
    deploy:
      resources:
        limits: { memory: 2G }

  redis-cache:
    ports: !override []
    command: ["redis-server", "--save", "", "--maxmemory-policy", "allkeys-lru",
              "--maxmemory", "512mb", "--requirepass", "${REDIS_PASSWORD:?required}"]

  redis-queue:
    ports: !override []
    command: ["redis-server", "--appendonly", "yes", "--maxmemory-policy", "noeviction",
              "--requirepass", "${REDIS_PASSWORD:?required}"]

  minio:
    ports: !override []
    environment:
      MINIO_ROOT_PASSWORD: ${S3_SECRET_KEY:?required}

  loki:
    ports: !override []

  alloy:
    ports: !override []

  # ── the applications, which are containers here ───────────
  web:
    build: { context: .., dockerfile: apps/web/Dockerfile }
    restart: unless-stopped
    env_file: [.env.production]
    environment:
      APP: web
      ENV: production
    depends_on:
      postgres: { condition: service_healthy }

  worker:
    build: { context: .., dockerfile: apps/worker/Dockerfile }
    restart: unless-stopped
    env_file: [.env.production]
    environment:
      APP: worker
      ENV: production
    depends_on:
      postgres: { condition: service_healthy }

  # Every open browser stream, and nothing else. The same `.env.production`, so the
  # same `AUTH_SECRET` — the web app signs the cookie this process reads.
  realtime:
    build: { context: .., dockerfile: apps/realtime/Dockerfile }
    restart: unless-stopped
    env_file: [.env.production]
    environment:
      APP: realtime
      ENV: production
      REALTIME_PORT: "3001"
    # Longer than `REALTIME_SHUTDOWN_TIMEOUT_MS`, or Docker kills the drain half-way.
    stop_grace_period: 30s
    depends_on:
      postgres: { condition: service_healthy }

  caddy:
    image: caddy:2-alpine
    restart: unless-stopped
    ports: ["80:80", "443:443"]
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddydata:/data
    depends_on: [web]

volumes:
  caddydata:
```

**`!override []`** replaces the base file's `ports` list rather than merging with it. Without the tag
Compose appends, and the publish you were trying to remove stays.

**`${VAR:?required}`** makes Compose refuse to start when the variable is unset, instead of
substituting an empty string. A Redis that silently starts with `--requirepass ""` accepts every
connection.

**`--maxmemory 512mb` on the cache** is what makes `allkeys-lru` mean anything. Without a ceiling the
policy never triggers and the cache grows until the box does.

### Readiness: `depends_on` is the start of the answer, not the whole of it

`depends_on: { postgres: { condition: service_healthy } }` gets the container *started* in the right
order. It says nothing about whether the app inside it can serve a request — the process still has to
parse its environment, build a container, and open its own connections.

**`GET /api/health` is that answer**, and it is the endpoint a load balancer, an orchestrator, or a
`caddy` health check should be pointed at rather than at the port being open:

```yaml
  web:
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://localhost:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
      interval: 10s
      timeout: 3s
      retries: 5
      start_period: 20s
```

**It is a readiness probe, and the distinction decides what happens on a 503.** Readiness means *do
not send me traffic yet* — a rolling deploy holds the instance out of the pool while Postgres is
still starting, and puts it back when the answer changes. A liveness probe on the same endpoint kills
the container instead, which is the wrong response to a dependency that is merely slow, and turns one
slow database into a restart loop across every instance.

The report names `database`, `cache`, `queue` and `analytics`; `analytics` is `null` when ClickHouse
is not configured, which is neither healthy nor degraded. **Loki is deliberately not in it** — logs
are lossy by design, so a collector being down is not a reason to drain an instance that is serving
correctly ([Data and scale](../opinions/data-and-scale.md)).

**The worker has no HTTP surface and therefore no equivalent.** Its liveness signal is the
`process.started` line it emits with its consumer count, and its readiness is that it consumes —
which is why the `analytics-reconcile` schedule exists ([25](../setup/25-worker-app.md)): a worker
that died quietly on a Tuesday is not something a probe finds.

### The one thing that gets simpler in production

**The applications are containers here, and they were not locally.** `pnpm dev` runs on the host, so
Alloy needed the `infra/logs` file tail to see anything ([alloy](reference/alloy.md)).

In production `web`, `worker` and `realtime` are in the same Compose project, so `discovery.docker` picks them up
with **no configuration change at all** — the `com.docker.compose.project=ratchet` filter already
matches them. The file-tail source simply goes unused.

`APP: web`, `APP: worker` and `APP: realtime` are what make the `app` label distinguish the three, which is exactly why
the pipeline reads that label from the log body rather than from the container name.

### TLS

**`infra/Caddyfile`** — illustrative; write it on the host, it is not in the repository.

```
example.com {
    # Before the catch-all. `flush_interval -1` writes each event as it arrives; Caddy
    # already streams `text/event-stream`, and saying so survives a config refactor.
    handle /api/realtime/* {
        reverse_proxy realtime:3001 {
            flush_interval -1
        }
    }
    reverse_proxy web:3000
}
```

**The stream path goes to its own process.** Every open tab holds one or two streams for as long as it
is open, and `apps/realtime` holds all of them so the web app's event loop holds none. The browser
still sees one origin, which is what lets the session cookie ride along. Behind nginx instead, the
location block wants `proxy_buffering off` and `proxy_read_timeout` above the thirty-minute stream age.

Caddy obtains and renews Let's Encrypt certificates automatically, and `caddydata` persists them —
without that volume you re-issue on every deploy and hit rate limits. Traefik and nginx both work;
Caddy is four lines.

Note both targets are **service names on the bridge network**. Caddy is the only container with a
published port.

### Secrets

`.env.production` lives on the VPS and is never committed. `.gitignore` already covers `.env.*` with
one exception for `.env.example`, so this is enforced rather than remembered.

Generate real values — the local ones are `ratchet` everywhere on purpose, because a scratch database
behind a secret is a scratch database nobody can debug:

```bash
openssl rand -base64 32      # AUTH_SECRET, POSTGRES_PASSWORD, REDIS_PASSWORD, …
```

Anything better than a file — Docker secrets, SOPS, a cloud secret manager — is an improvement and
none of it changes the application, which reads `process.env` in exactly two files.

### Deploying

```bash
git pull
docker compose -f docker-compose.yml -f docker-compose.prod.yml build web worker
docker compose -f docker-compose.yml -f docker-compose.prod.yml run --rm web pnpm db:migrate
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```

**Migrations run before the new containers start**, as a one-shot. Running them from a container that
is already serving traffic means the old code briefly meets the new schema.

That ordering forces a discipline worth naming: **every migration must be compatible with the
currently-running code**. Add a column before writing to it, deploy the writer, then remove the old
column in a later release. A rename is two deploys.

Building on the VPS keeps the setup to one machine and costs a slow deploy. Building in CI and
pushing to a registry is the next step, and changes only where `build:` becomes `image:`.

### Backups — the part that actually matters

The derived-store table in [index](index.md) already says what must be backed up, because it says
what cannot be rebuilt:

| Volume | Back up? | Why |
|---|---|---|
| `pgdata` | **yes** | the source of truth |
| `miniodata` — `ratchet` bucket | **yes** | uploaded bytes are a second source of truth |
| `redisqueuedata` | **yes** | a queued job is derived from nothing |
| `miniodata` — `loki` bucket | no | 30 days of diagnostics, lossy by design |
| redis-cache | no volume | rebuilt from Postgres on a miss |
| `clickhousedata` | no | replay the activity log |

```bash
# nightly, to somewhere that is not this VPS
docker compose exec -T postgres pg_dump -U ratchet -Fc ratchet > backup-$(date +%F).dump
docker compose exec -T minio mc mirror local/ratchet /backup/ratchet
```

> **A backup you have not restored is a hypothesis.** Restore into a scratch database and run the
> app against it, on a schedule. This is the single most commonly skipped step on a self-hosted VPS
> and the only one that is unrecoverable.

`pg_dump` is adequate up to a few tens of gigabytes. Past that, continuous archiving — WAL-G or
pgBackRest to object storage — gives point-in-time recovery, and is the moment managed Postgres
starts looking cheap.

---

## What breaks first

In rough order, and none of them is the database:

| Symptom | Move to |
|---|---|
| Deploys have visible downtime | Two `web` replicas behind Caddy, drain on stop |
| The box is memory-bound at idle | Managed Loki (Grafana Cloud) — it is the largest non-Postgres consumer |
| Disk fills | S3 for uploads; MinIO on the same disk as `pgdata` is the trap |
| Postgres CPU spikes on dashboards | A read replica, or KPI snapshot tables — [Data and scale](../opinions/data-and-scale.md) §5 |
| A bad deploy loses queued jobs | Managed Redis for the queue, with real persistence |
| One machine is a single point of failure | Everything below |

**Two web replicas is the highest-value early move**, and the architecture already permits it: the
web tier is stateless by construction — no request state in `Container`, no module-scope
`QueryClient`, sessions in Postgres and Redis. The worker is separate and BullMQ's repeatable jobs
dedupe across replicas, so it scales independently.

---

## Phase 2 — managed services, in risk order

Move things **in increasing order of how much it hurts to get wrong**, not in order of cost. Each row
is one or two lines in `.env.production` and a restart.

| # | Service | Becomes | Config change | Risk |
|---|---|---|---|---|
| 1 | Loki | Grafana Cloud (or any Loki-compatible host) | `loki.write` url + basic auth | none — derived, 30 days |
| 2 | MinIO | S3 / R2 | `S3_*`, `S3_FORCE_PATH_STYLE=false` | low — copy, then flip |
| 3 | redis-cache | Upstash / ElastiCache | `REDIS_CACHE_URL` | none — it is a cache |
| 4 | redis-queue | a **separate** managed Redis | `REDIS_QUEUE_URL` | medium — drain first |
| 5 | Postgres | RDS / Cloud SQL / Neon | `DATABASE_URL` | high — the real migration |

**ClickHouse is deliberately not in that table.** Every row above is *the same capability, operated
by somebody else*. Adopting ClickHouse is a **new capability** on a different axis, and it has its own
section below.

### 1. Logs first, because losing them costs nothing

```alloy
loki.write "default" {
  endpoint {
    url = "https://logs-prod-000.grafana.net/loki/api/v1/push"
    basic_auth {
      username = env("GRAFANA_CLOUD_USER")
      password = env("GRAFANA_CLOUD_TOKEN")
    }
  }
}
```

Drop `loki` from the overlay and keep Alloy. **The pipeline, the four labels, and the
event catalog are unchanged** — this is the payoff for never letting a package import a Loki client
([Dependencies](../opinions/dependencies.md) Tier 0).

Start here because it is free to reverse and it removes the largest memory consumer after Postgres.

### 2. Object storage

Uploaded objects are immutable and addressed by key, so this is a copy and a flip rather than a
migration:

```bash
mc mirror --watch local/ratchet s3/your-bucket    # runs until you stop it
```

Then change five values and restart. `S3_FORCE_PATH_STYLE=false` is the one that is easy to miss and
produces DNS errors that name a bucket-prefixed host.

**The `loki` bucket does not need moving** — if step 1 is done, the managed log host owns that storage.

### 3 and 4. The two Redis instances, separately

**The cache is trivial**: change the URL, restart, accept a cold minute while it refills from
Postgres. This is what "derived" buys.

**The queue is not.** A queued job exists nowhere else, so:

1. Stop the worker consuming; let publishers keep enqueueing to the old instance.
2. Wait for depth to reach zero.
3. Flip `REDIS_QUEUE_URL`, restart both.
4. Confirm the old instance is empty before deleting it.

**Keep them as two managed instances.** Consolidating to save a few dollars re-creates exactly the
problem the local split exists to prevent: one eviction policy for two incompatible durability needs
([redis](reference/redis.md)).

Managed Redis providers differ on `noeviction` support and persistence guarantees — check both before
choosing, because a queue on an instance that evicts is a queue that loses work silently.

### 5. Postgres last

Highest value, highest risk, and the one where the managed option is most worth paying for —
backups, point-in-time recovery, and failover stop being your problem.

Two routes:

**Dump and restore.** Simple, needs a maintenance window sized by your data.

```bash
pg_dump -Fc $OLD | pg_restore -d $NEW
```

**Logical replication.** Near-zero downtime, more moving parts: replicate into the managed instance,
let it catch up, then a brief pause to switch `DATABASE_URL`. Most managed providers document this
path and some tool it.

Whichever you choose, **verify the extensions exist on the target first**. `pgvector` is not available
everywhere, and finding out after the dump is a bad afternoon:

```sql
SELECT * FROM pg_available_extensions WHERE name IN ('vector', 'pg_trgm', 'uuid-ossp');
```

Also confirm the partitioned tables arrived as partitioned rather than as one flat table — a
`pg_dump`/`restore` preserves partitioning, but a naive `COPY`-based migration does not, and
`activity_log` silently becomes a table that will need the painful conversion later
([13](../setup/13-infrastructure-postgres.md)).

---

## Adopting ClickHouse — a different axis

Everything in Phase 2 is *the same capability, operated by somebody else*. This is not that: it is a
**new store, a new consumer, and a new dependency**, and it happens on its own timeline. You can run
ClickHouse on the original VPS or reach ClickHouse Cloud from a fully-managed stack; the two
decisions do not interact.

**Do not start here.** [Data and scale](../opinions/data-and-scale.md) is explicit that Postgres
covers every question this kit will ask for years, and the container in the compose file is
deliberately stopped.

### The trigger, and the prerequisite

**The trigger:** snapshot tables stop covering the questions being asked. Not "the table is large",
not "ClickHouse would be faster" — the specific moment when people want aggregates nobody precomputed.

**The prerequisite is the part that gets skipped.** ClickHouse is fed by the worker consuming domain
events, so before the store is worth starting, three things must exist:

1. **A projection consumer** on the `analytics` queue, writing rows.
2. **A daily reconciliation job**, comparing row counts per day against the activity log.
3. **A replay path** — the ability to rebuild the whole store from the activity log.

Without the first, a running ClickHouse is an empty database that looks like a decision. Without the
second, a consumer that dies quietly on a Tuesday surfaces as a wrong number in March. Without the
third, the store is not derived at all, whatever the documentation claims.

### What changes in the code

The write half is already written: `ClickHouseAnalyticsProjector`, the projection consumer and the
nightly reconciliation ship, and `CLICKHOUSE_URL` turns them on
([15](../setup/15-infrastructure-package.md)).

The read half is not, and that is deliberate. Adding it is a new port in
`packages/application/src/port/`, an adapter behind it, one line in `Container`, and the queries the
dashboard actually asks — a day's work against a store that has been filling and reconciling for
days. The kit shipped that port once, guessed at two questions, and deleted it unused; see
[Simplicity](../opinions/simplicity.md).

`ContainerConfig` gains an `analytics` block, and `apps/*/src/env.ts` gains the variables to fill it —
still the only two files in the repository that read `process.env`.

### On the VPS: give it its own box

**ClickHouse and Postgres on one machine is the mistake to avoid.** ClickHouse is designed to use as
much memory and I/O as it can get — that is what makes it fast — and an OLTP database whose
performance depends on a warm page cache is the worst possible neighbour. Under a heavy analytical
query, Postgres latency degrades in a way that looks like a database problem and is a scheduling one.

If it must share, cap it explicitly and accept that you have made both slower:

```yaml
clickhouse:
  ports: !override []
  environment:
    CLICKHOUSE_PASSWORD: ${CLICKHOUSE_PASSWORD:?required}
  deploy:
    resources:
      limits: { memory: 4G }
```

A separate instance wants materially more than the application box:

| | vCPU | RAM | Disk |
|---|---|---|---|
| Smallest useful | 4 | 16 GB | 200 GB SSD |

Reaching it across machines means a private network — a VPC, WireGuard, or the provider's internal
network. **Not the public internet**: the same rule as every other store, and ClickHouse's HTTP port
is as attractive to scanners as Postgres's.

> **`CLICKHOUSE_DEFAULT_ACCESS_MANAGEMENT: 1` in the base compose file is a local convenience.** It
> exists so a scratch instance is easy to poke at. Set a real password and drop it before anything
> reachable by anyone else.

### Backups: none, and that is a claim to test

`clickhousedata` is not in the backup table, because the store is rebuildable by replaying the
activity log from Postgres.

**That is only true if the replay actually works**, and the day you need it is the wrong day to find
out. Before relying on it:

1. Replay a month into a scratch ClickHouse.
2. Compare row counts and a few aggregates against the live store.
3. Time it — a rebuild that takes four days is not a recovery plan.

The reconciliation job is the same query, run daily on one day of data. If it is in place, this test
is mostly already running.

**Backing up ClickHouse instead is a signal, not a shortcut.** If a replay is not viable, something is
authoritative there that should not be — most likely a KPI computed in a materialized view and stored
nowhere else, which is exactly the way the store stops being derived.

### Managed

ClickHouse Cloud, Altinity.Cloud and Aiven all run it. The migration path is unusual and pleasant:
**there is nothing to migrate.** Point the consumer at the managed instance, replay, and drop the old
one — the property that makes backups unnecessary makes the move trivial too.

This is the one store where "managed from day one" is the easy call, because the operational burden
is high and the switching cost is near zero.

---

## What never changes

Worth stating plainly, because it is most of the system.

- **`packages/application`** — sharding and hosting are repository concerns; use-cases never learn.
- **`packages/permissions`** — pure computation, identical answer in every runtime.
- **`packages/contracts`** — unchanged.
- **The event catalog and the four log labels** — the pipeline moves, the vocabulary does not.
- **Every port** — `CacheStore`, `QueuePublisher`, `StorageGateway`, `VectorStore`, `AnalyticsProjector`.
  A managed service is a different constructor argument in `Container`, one line each.
- **`.env` as the only config surface** — enforced by `check-architecture.mjs` §3, which is why
  "move a service" is never a code search.

The compose file, the overlay, and `.env.production` are the entire deployment surface. That is the
claim the architecture makes, and this page is where it either holds or does not.
