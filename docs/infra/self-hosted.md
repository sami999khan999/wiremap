---
title: self-hosted
description: Wiremap in one Docker container on your own machine, the compose alternative, GitHub without a public address, backups and upgrades — then the kit's guide for a VPS.
---

# Self-hosted

## One container on your own machine

Everything wiremap needs runs in one image, and its data lives on one volume:
- Postgres with pgvector, Redis, and MinIO for graph files;
- Mailpit, to catch mail until you give it SMTP;
- the web app, the worker, and git with the CLI for scans.

```bash
docker build -f docker/wiremap/Dockerfile -t wiremap .
docker run -d --name wiremap --restart unless-stopped \
  -p 127.0.0.1:43000:43000 -p 127.0.0.1:48025:48025 \
  -v wiremap-data:/data --env-file wiremap.env wiremap
```

Open `http://localhost:43000` and sign up. The verification mail is in Mailpit at
`http://localhost:48025`. To make yourself the platform admin:

```bash
docker exec wiremap wiremap-admin grant you@example.com
```

**Ports are bound to `127.0.0.1`.** Only this machine reaches them: Docker's published ports
skip a host firewall (see below). Leave out `-p …48025` once mail goes out through SMTP.

**The env file** holds only what is yours. Every internal URL and setting is derived
inside the container. The secrets (`AUTH_SECRET`, the encryption key, the database and
storage passwords) are generated on first start into `/data/secrets.env`, and anything you
pass overrides them:

| Key | When |
|---|---|
| `GITHUB_APP_ID`, `GITHUB_APP_SLUG`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_WEBHOOK_SECRET`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | To connect repositories. Register the App as in [github-app](github-app.md), section "On your own machine" |
| `SMTP_URL`, `EMAIL_FROM` | To send real mail. Without them, mail goes to Mailpit |
| `CLOUDFLARE_TUNNEL_TOKEN`, `WIREMAP_PUBLIC_URL` | A public hostname, so GitHub webhooks arrive (optional) |
| `AUTH_REQUIRE_EMAIL_VERIFICATION=false` | A single-person install with no mail at all |
| `GITHUB_POLLING=false` | Turns off hourly branch polling |
| `WIREMAP_BACKUP_HOUR` | The UTC hour of the daily backup (`4`), or `off` |
| `WEB_PROCESSES`, `POSTGRES_SHARED_BUFFERS`, `REDIS_MAXMEMORY` | Sizing: `2`, `128MB`, `256mb` by default |

**GitHub.** Connecting, reading repositories and scanning all work from a machine GitHub
cannot reach. Scans run inside the container, and the source is deleted after each one. Push
webhooks cannot arrive, so each hour the container checks every tracked branch and scans the
ones that moved. With a Cloudflare Tunnel, webhooks arrive and pushes scan within seconds.
Both are covered in [github-app](github-app.md).

**Backups.** Every day at 04:00 UTC the container writes `/data/backups/wiremap-<time>/`, and
keeps seven. Each holds `database.dump`, `objects.tar.gz`, and `secrets.env`, without which the
stored keys cannot be read.

```bash
docker exec wiremap wiremap-admin backup              # one now
docker exec wiremap wiremap-admin backups             # list them
docker exec wiremap wiremap-admin restore wiremap-20261004T040000Z && docker restart wiremap
```

Copy `/data/backups` off the machine as well. A backup on the same volume does not survive
losing the volume.

**Upgrades.** Build or pull the new image, then `docker rm -f wiremap` and run the same
`docker run`. The volume is kept and migrations run on start. A volume made by a different
Postgres major version is refused, with a message. Restore a backup into a fresh volume
instead.

**Resources.** About 420 MB of memory at idle, and an image of about 1.2 GB. `docker logs
wiremap` is the whole system: each support service is prefixed, and the app writes JSON lines.

**The compose alternative.** `docker/wiremap/compose.yml` runs the stores as their own
containers (pgvector, Redis, MinIO, Mailpit) beside one app container, the same image with
`WIREMAP_EXTERNAL_STORES=1`:
1. Put `POSTGRES_PASSWORD`, `MINIO_PASSWORD` and the keys above in `docker/wiremap/.env`,
   which is gitignored.
2. Run `docker compose -f docker/wiremap/compose.yml up -d`.

Back up its volumes the usual way; `wiremap-admin backup` covers only the single container's
own stores.

The image, its scripts and the services it supervises are in `docker/wiremap/`, and the plan
behind them is [`SELF-HOSTED-PLAN.md`](../plans/SELF-HOSTED-PLAN.md).

## A VPS, then managed services

> **Wiremap's cloud path is [deployment](deployment.md):** Vercel, Cloudflare, Neon, Upstash
> and B2, all on free tiers. What follows is the kit's original guide for running the
> separate processes on a box of your own, with the worker on BullMQ. Its apps/realtime steps
> no longer apply; see [`docs/scale/realtime.md`](../scale/realtime.md).

The same services, on a machine you rent. Then, service by service, on machines somebody else
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
postgres      0.0.0.0:45432->5432/tcp
redis         0.0.0.0:46379->6379/tcp    ← no password
mailpit       0.0.0.0:41025->1025/tcp, 0.0.0.0:48025->8025/tcp   ← no auth
minio         0.0.0.0:49000->9000/tcp, 0.0.0.0:49001->9001/tcp
```

On a laptop behind NAT that is convenient and harmless. **On a VPS with a public IP it is a database, an
unauthenticated Redis holding the job queue, a mail inbox and an object store on the open
internet.** Scanners find an open Postgres in minutes.

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
ports: ["127.0.0.1:45432:5432"]
```

```bash
ssh -L 5432:localhost:45432 you@vps    # then psql against localhost:5432
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

Postgres wants the memory. Disk is dominated by `pgdata` and MinIO.

There is no log store and no analytics store on this box. Logs go to stdout, and Docker's log
driver keeps what it keeps.

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

  redis:
    ports: !override []
    command: ["redis-server", "--appendonly", "yes", "--maxmemory-policy", "noeviction",
              "--requirepass", "${REDIS_PASSWORD:?required}"]

  # Only while you have no real provider. Production mail goes out through `SMTP_URL`.
  mailpit:
    ports: !override []

  minio:
    ports: !override []
    environment:
      MINIO_ROOT_PASSWORD: ${S3_SECRET_KEY:?required}

  # ── the applications, which are containers here ───────────
  web:
    build: { context: .., dockerfile: apps/web/Dockerfile }
    restart: unless-stopped
    # One web process per core: rendering is single-threaded, and one process leaves the
    # other cores idle. cluster.mjs forwards SIGTERM, drains each worker and restarts a
    # crashed one. WEB_PROCESSES sets the count; processes x DATABASE_POOL_MAX < 200.
    command: ["node", "apps/web/cluster.mjs"]
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

**The one Redis keeps `noeviction`.** It holds the queue as well as the cache, so the queue's rule
wins ([redis](reference/redis.md)). A cache that should evict under a memory ceiling wants its own
instance — [split-redis](../scale/split-redis.md).

**`minio-init` still runs in production.** It creates the bucket on a fresh volume, then exits.

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

The report names `database`, `cache`, `queue`, `realtime` and `analytics`. `analytics` is always
`null`: lite runs no analytics store, which is neither healthy nor degraded. **No log store is in
it**, and none would be once ported — logs are lossy by design, so a collector being down is not a
reason to drain an instance that is serving correctly ([Data and scale](../opinions/data-and-scale.md)).

**The worker has no HTTP surface and therefore no equivalent.** Its liveness signal is the
`process.started` line it emits with its consumer count, and its readiness is that it consumes —
([25](../setup/25-worker-app.md)). Watch queue depth instead: a worker that died quietly on a
Tuesday is not something a probe finds.

### Logs

**The applications are containers here, and they were not locally.** Each writes JSON lines to
stdout, so `docker compose logs web` reads them. Nothing else collects them.

`APP: web`, `APP: worker` and `APP: realtime` set the `app` field in every line. That is what tells
the three apart once their output is mixed.

Searching logs across days, or keeping them past a restart, needs a log store. That is
[logs](../scale/logs.md). The line format does not change when you add one.

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
    # Compressed here and only here: an encoder buffers, and a buffered stream stalls.
    handle {
        encode zstd gzip
        reverse_proxy web:3000
    }
}
```

**Compress the web app's responses at the proxy.** The Node server sends them as they are. A
large doc page is about 1.1 MB raw and 59 KB gzipped, because the sidebar repeats one set of class
names per link. Leave the stream path out: an encoder buffers, and a buffered event stream reaches
the tab late or never. Behind nginx, that is `gzip on` in the web location and not in the stream
one.

**The stream path goes to its own process.** Every open tab holds one or two streams for as long as it
is open, and apps/realtime holds all of them so the web app's event loop holds none. The browser
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
| `miniodata` — uploads | **yes** | uploaded bytes are a second source of truth |
| `miniodata` — `cold/` | **yes** | a deleted tenant's archive, the only copy for its 30 days |
| `miniodata` — `export/` | no | a download that expires after 7 days; run the export again |
| `redisdata` | **yes** | a queued job is derived from nothing; the cache inside it rebuilds |

```bash
# nightly, to somewhere that is not this VPS
docker compose exec -T postgres pg_dump -U ratchet -Fc ratchet > backup-$(date +%F).dump
mc mirror local/ratchet /backup/ratchet   # `mc` on the host; the server image ships none
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
| Disk fills | S3 for uploads; MinIO on the same disk as `pgdata` is the trap |
| Logs are gone after a restart, or cannot be searched | A log store — [logs](../scale/logs.md) |
| Postgres runs out of connections | A pooler — [pgbouncer](../scale/pgbouncer.md) |
| Postgres CPU spikes on dashboards | KPI snapshot tables — [Data and scale](../opinions/data-and-scale.md) §5 — or a [read replica](../scale/read-replica.md) |
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
| 1 | MinIO | S3 / R2 | `S3_*`, `S3_FORCE_PATH_STYLE=false` | low — copy, then flip |
| 2 | Redis | managed Redis with `noeviction` and persistence | `REDIS_CACHE_URL`, `REDIS_QUEUE_URL` | medium — drain first |
| 3 | Postgres | RDS / Cloud SQL / Neon | `DATABASE_URL`, `DATABASE_DIRECT_URL` | high — the real migration |

Mail is not a row. Mailpit was never a production service: point `SMTP_URL` at a real provider
before the first real user ([mailpit](reference/mailpit.md)).

**Stores lite does not run are not rows either.** Every row above is *the same capability,
operated by somebody else*. A log store, an analytics store, a pooler, a replica or a second shard
node is a **new capability**, and it has its own page — see [below](#adding-what-lite-cut).

### 1. Object storage

Uploaded objects are immutable and addressed by key, so this is a copy and a flip rather than a
migration:

```bash
mc mirror --watch local/ratchet s3/your-bucket    # runs until you stop it
```

Then change five values and restart. `S3_FORCE_PATH_STYLE=false` is the one that is easy to miss and
produces DNS errors that name a bucket-prefixed host.

**Copy the whole bucket, prefixes included.** `cold/` holds deleted tenants' archives. `export/`
can be left behind — its objects expire in a week. The nightly `retention` job writes the `export/`
lifecycle rule onto the new bucket on its first run.

### 2. Redis — treat it as the queue

Lite's one Redis holds the cache and the queue. The cache would be trivial to move on its own. The
queue is not, and it sets the procedure. A queued job exists nowhere else, so:

1. Stop the worker consuming; let publishers keep enqueueing to the old instance.
2. Wait for depth to reach zero.
3. Flip `REDIS_CACHE_URL` and `REDIS_QUEUE_URL`, restart everything.
4. Confirm the old instance is empty before deleting it.

**This is a good moment to split.** The code already reads two URLs. Point `REDIS_CACHE_URL` at an
instance that evicts and `REDIS_QUEUE_URL` at one that does not — [split-redis](../scale/split-redis.md).
The cache half then needs no drain: it refills from Postgres.

Managed Redis providers differ on `noeviction` support and persistence guarantees — check both before
choosing, because a queue on an instance that evicts is a queue that loses work silently.

### 3. Postgres last

Highest value, highest risk, and the one where the managed option is most worth paying for —
backups, point-in-time recovery, and failover stop being your problem.

Two routes:

**Dump and restore.** Simple, needs a maintenance window sized by your data.

```bash
pg_dump -Fc $OLD | pg_restore -d $NEW
```

**Logical replication.** Near-zero downtime, more moving parts: replicate into the managed instance,
let it catch up, then a brief pause to switch `DATABASE_URL` and `DATABASE_DIRECT_URL`. Most managed providers document this
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

**Both URLs move together.** In lite they name the same server. If the managed provider puts a
pooler in front, `DATABASE_URL` gets the pooled address and `DATABASE_DIRECT_URL` the direct one —
[pgbouncer](../scale/pgbouncer.md). The code already runs behind a transaction pooler unchanged.

---

## Adding what lite cut

Everything in Phase 2 is *the same capability, operated by somebody else*. This is not that. Each
piece below is a **new store or a new process**, and it happens on its own timeline. The code keeps
the seam for each, so each is a port back rather than a rewrite.

| Piece | When | Guide |
|---|---|---|
| A connection pooler | Postgres runs out of connections | [pgbouncer](../scale/pgbouncer.md) |
| A read replica | batch reads compete with requests | [read-replica](../scale/read-replica.md) |
| A second shard node | one Postgres cannot hold every tenant | [shard-nodes](../scale/shard-nodes.md) |
| Split Redis | the cache wants to evict, or flushing it must spare the queue | [split-redis](../scale/split-redis.md) |
| A log store | stdout stops being enough | [logs](../scale/logs.md) |
| An analytics store | snapshot tables stop covering the questions | [analytics](../scale/analytics.md) |
| Calendar retention and a cold tier | old months cost more than they are worth | [retention](../scale/retention.md) |

**Do not start here.** [Data and scale](../opinions/data-and-scale.md) is explicit that one
Postgres covers every question this kit will ask for years.

---

## What never changes

Worth stating plainly, because it is most of the system.

- **`packages/application`** — sharding and hosting are repository concerns; use-cases never learn.
- **`packages/permissions`** — pure computation, identical answer in every runtime.
- **`packages/contracts`** — unchanged.
- **The event catalog and the four log labels** — stdout today, a log store later; the vocabulary
  does not move.
- **Every port** — `CacheStore`, `QueuePublisher`, `StorageGateway`, `VectorStore`, `EmailSender`.
  A managed service is a different constructor argument in `Container`, one line each.
- **`.env` as the only config surface** — enforced by `check-architecture.mjs` §3, which is why
  "move a service" is never a code search.

The compose file, the overlay, and `.env.production` are the entire deployment surface. That is the
claim the architecture makes, and this page is where it either holds or does not.
