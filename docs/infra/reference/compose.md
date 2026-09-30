---
title: docker-compose.yml
description: Fifteen services, five profiles, eight volumes and one network — what every block does and which parts are load-bearing.
---

# `docker-compose.yml`

The only file here that Docker reads directly. Everything else is mounted into a container by it.

```yaml
name: lite
```

**The project name, and it appears in two places.** It prefixes every container (`lite-loki-1`),
every volume (`lite_pgdata`) and the network (`lite_default`) — and it is what
[`alloy.config.alloy`](alloy.md) filters on to decide which containers to collect. Change one without
the other and Alloy silently collects nothing: no error, no logs, and a debugging session that starts
in the wrong place.

---

## The network

There is no `networks:` block, which is itself the decision. Compose creates `lite_default` — a
bridge network — and joins every service to it.

Inside that network, **a service name is a hostname**. Docker runs an embedded DNS server at
`127.0.0.11` in each container, so `loki` resolves to the Loki container's address without anything
being configured. That is why `alloy.config.alloy` can say `http://loki:3100` and
`loki.config.yml` can say `endpoint: minio:9000`.

Declaring networks explicitly would buy segmentation — keeping Alloy off the database, say. That is
worth doing in production and is noise here, where every service is on one machine and the isolation
would be theatre.

---

## Services

### The four stores

| Service | Image | Notes |
|---|---|---|
| `postgres` | `pgvector/pgvector:pg17` | [postgres](postgres.md) |
| `redis-cache` | `redis:7-alpine` | evicts, no persistence — [redis](redis.md) |
| `redis-queue` | `redis:7-alpine` | never evicts, always persists — [redis](redis.md) |
| `minio` | `coollabsio/minio:RELEASE.2025-10-15T17-29-55Z` | S3 stand-in — [minio](minio.md) |

`minio-init` is a fifth, and it is a **one-shot**: an `mc` image runs an entrypoint that waits for
the MinIO API, creates both buckets and exits. `exited (0)` is success, and `compose-wait.mjs` holds
the stack un-ready until it is — a one-shot still running is doing the work the next step reads. It carries `restart: "no"` and no healthcheck, because a
container that is supposed to stop cannot be "unhealthy" — and without the explicit `restart` the
project default would keep starting a container whose whole job is to finish.

### Observability, profile `observability`

| Service | Image | Notes |
|---|---|---|
| `loki` | `grafana/loki:3.3.2` | [loki](loki.md) |
| `alloy` | `grafana/alloy:v1.5.1` | [alloy](alloy.md) |

#### Why there is no log UI

Two services, not three: this profile collects and stores, and nothing in it reads back. A `grafana`
container used to sit here and was removed deliberately.

The reasoning is that a log console and the super admin dashboard are the same job for the same
person, and running both means two places to look. The query an operator actually needs — *these
logs, for this tenant, joined to that tenant's audit rows* — is one Grafana cannot express, because
it has no concept of an organization. Grafana also carried the ad-hoc Postgres surface, which the
dashboard absorbs for the same reason.

The cost is accepted knowingly: **until the dashboard ships there is no log viewer**, and the
fallbacks are `docker compose logs -f <service>` and curl against Loki's `query_range` endpoint
([loki](loki.md)). Both stay useful afterwards — a log query that needs the app running is no use
during the incident where the app is down.

### Analytics, profile `analytics`

`clickhouse`, deliberately not started. See [clickhouse](https://github.com/prodicle/loadbearing_tanstack_start_kit/blob/3fafa78c2f42d2d718236d7666429b858199118a/docs/infra/reference/clickhouse.md).

### The second node, profile `sharded`

`postgres-shard-1` and `pgbouncer-shard-1`, also deliberately not started. Same image, same
`postgres.init.sql`, its own volume — a shard sharing the catalog's data directory would rehearse
nothing. `pnpm infra:up:sharded` starts them, and the two commented lines in `.env.example` point
`DATABASE_SHARD_1_URL` at `:6433` and its direct counterpart at `:5433`.

There is no range or key configuration beside them. `shard_assignments` on the catalog names the
node, one row per tenant, so a second node is two URLs and nothing else — see
[sharding](../../../packages/infrastructure/docs/reference/sharding.md).

### Node 0's standby, profile `replica`

`postgres-replica`, a streaming hot standby of `postgres`. `pnpm infra:up:replica` starts it, and
`DATABASE_REPLICA_URL` in `.env.example` points at `:25434`. It has no pooler in front: nothing
writes to it, and the reads that use it are the worker's batch reads, a handful of connections.

**It clones itself on an empty volume.** The entrypoint runs `pg_basebackup -R` against the
primary when `$PGDATA` holds no `PG_VERSION`. `-R` writes `standby.signal` and the connection
string, so the image's own entrypoint then finds a data directory and starts a standby rather
than running `initdb`. To re-clone, remove the `pgreplicadata` volume and start it again.

**The primary needed one line for it.** The image's `pg_hba.conf` allows replication from
localhost only. `infra/pg_hba.conf` restates the image's rules and adds `host replication all all
scram-sha-256`, and the primary is started with `hba_file` pointing at it. Mounted rather than
written into the volume, so an existing volume gets the rule too.

**It carries the primary's settings.** A hot standby refuses to start with a lower
`max_connections` or `max_locks_per_transaction` than its primary.

Which reads use it, and why a read never sees less than the primary had, is in
[sharding](../../../packages/infrastructure/docs/reference/sharding.md#read-replicas).

### The colder tier, profile `cold-tier`

`minio-cold` and `minio-cold-init`, for `25.3`. **MinIO has no storage classes of its own.** A
lifecycle transition on MinIO names a *remote tier*, another object store that MinIO moves the
object to. So the rehearsal is a second MinIO. `minio-cold-init` creates its `tier` bucket and
registers it on `minio` as `COLD`, the value `S3_COLD_STORAGE_CLASS` names.

**`tier ls | grep`, never `tier info`, decides whether to add it.** `mc ilm tier info` exits 0
for a tier that does not exist, so a check built on it never adds one. The first version of this
service did exactly that, and printed "cold tier ready" over a bucket with no tier.

It publishes no port. Nothing outside the network dials it: the application writes a rule
naming `COLD`, and MinIO does the moving. See
[storage policy](../../../packages/infrastructure/docs/reference/storage-policy.md).

---

## Profiles

A service with no `profiles:` key always runs. A service with one runs only when that profile is
selected.

```bash
docker compose ... up -d                                  # 5 services
docker compose ... --profile observability up -d          # 8
docker compose ... --profile observability --profile analytics up -d   # 9
docker compose ... --profile observability --profile sharded up -d     # 10
docker compose ... --profile observability --profile replica up -d     # 9
docker compose ... --profile observability --profile cold-tier up -d   # 10
```

The `pnpm infra:*` scripts wrap those, with `observability` on by default.

> **`--profile "*"` on `down`, `reset` and `logs` is load-bearing.** Compose only acts on services in
> the profiles it was given. Without it, `docker compose down` leaves a profiled service running, and
> `logs -f` silently omits it from the output you are reading to debug it.

---

## Volumes

Eight named volumes, and which are disposable is the whole point.

| Volume | Service | Rebuildable from |
|---|---|---|
| `pgdata` | postgres | migrations + seeds |
| `pgshard1data` | postgres-shard-1 | migrations + the tenants the directory places there |
| `pgreplicadata` | postgres-replica | the primary — it is a copy, re-cloned on an empty volume |
| `redisqueuedata` | redis-queue | **nothing** |
| `miniodata` | minio | uploads are a second source of truth; Loki chunks are not |
| `miniocolddata` | minio-cold | **nothing** — a transitioned object lives only here |
| `lokidata` | loki | index only — chunks live in MinIO |
| `clickhousedata` | clickhouse | replaying the activity log |

**`redis-cache` has no volume, on purpose.** A named volume for something explicitly disposable
invites the next person to treat it as durable.

`pnpm infra:reset` destroys all eight. Locally that is fine — it is a scratch database. The habit is
what matters: in any environment with real pending work, clearing the cache and clearing the queue
are different operations, and the two-instance split is what makes it possible to do one without the
other.

### Bind mounts

Every config file is mounted individually, read-only:

```yaml
- ./loki.config.yml:/etc/loki/config.yml:ro
- ./postgres.init.sql:/docker-entrypoint-initdb.d/01-extensions.sql:ro
- ./pg_hba.conf:/etc/postgresql/pg_hba.conf:ro
```

Docker creates the target's parent directories if they do not exist, so a single file can be placed
into a path the image never had. That is what removed the directory-per-service layout this folder
used to have.

Two exceptions are directory mounts, and both have to be:

```yaml
- ./logs:/var/log/app:ro              # Alloy globs *.log — a file mount cannot match a glob
- /var/run/docker.sock:/var/run/docker.sock:ro
```

**The socket needs a group, not just a mount.** It is `root:docker` on Linux and Alloy does not run
as root, so `group_add: ["${DOCKER_GID:-999}"]` is what makes the mount usable. Without it Alloy
starts, reports healthy, and collects nothing — the failure says nothing about its own cause. On
Docker Desktop the default is usually right; on Linux, `getent group docker` gives the real gid.

> **A single-file bind mount does not survive an editor that replaces the file.** Some editors write
> a new inode rather than modifying in place, and the container keeps the old one. Restart the
> service after editing a config; every one of these is read at startup anyway.

---

## Host ports

Every host port is a variable with the documented default; every container port is fixed.

```yaml
ports: ["${MINIO_CONSOLE_PORT:-9001}:9001"]
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
| `POSTGRES_PORT` | 25432 | `LOKI_PORT` | 23100 |
| `PGBOUNCER_PORT` | 26432 | `ALLOY_PORT` | 12345 |
| `REDIS_CACHE_PORT` | 26379 | `MAILPIT_UI_PORT` | 28025 |
| `REDIS_QUEUE_PORT` | 26380 | `SMTP_PORT` | 21025 |
| `S3_PORT` | 29000 | `CLICKHOUSE_HTTP_PORT` | 28123 |
| `MINIO_CONSOLE_PORT` | 29001 | `CLICKHOUSE_NATIVE_PORT` | 29002 |
| `POSTGRES_SHARD_1_PORT` | 25433 | `PGBOUNCER_SHARD_1_PORT` | 26433 |
| `POSTGRES_REPLICA_PORT` | 25434 | | |

These defaults are what a checkout with no `.env` gets, which is exactly what CI is, so
`check:architecture` §27 asserts each one equals the value `.env.example` documents. It also pairs
each `*_PORT` with the URL that dials it — `POSTGRES_PORT` with `DATABASE_DIRECT_URL`,
`PGBOUNCER_PORT` with `DATABASE_URL` — and fails when the two disagree. `MINIO_CONSOLE_PORT`,
`MAILPIT_UI_PORT`, `ALLOY_PORT` and `CLICKHOUSE_NATIVE_PORT` have no counterpart: nothing in the
application dials them, you do.

**Nothing inside the network changes when you override one**, because only the left-hand side moves.
`alloy.config.alloy` still says `loki:3100` regardless of `LOKI_PORT`.

Two defaults are non-obvious. ClickHouse's native port is `29002` rather than `29000`, because the
`1` prefix of its own `9000` would collide with MinIO's. And `ALLOY_PORT` keeps `12345`, which was
already clear of everything.

---

## Healthchecks and `depends_on`

Every long-running service but one has a healthcheck, because `depends_on` alone only waits for a
container to *start*, not to be *usable*. MinIO is the exception — see below.

```yaml
depends_on:
  minio-init: { condition: service_completed_successfully }
  loki:       { condition: service_healthy }
```

Four of the probes are worth knowing:

**MinIO** has no probe, having had two that could not run. `mc ready local` needed a binary the
server image does not ship, and the `local` alias it named is created by `minio-init` — which was
itself waiting on that healthcheck. `curl -sf /minio/health/live` replaced it and lasted until the
image did: the community rebuild that took over from the withdrawn `minio/minio` ships no `curl`
either, so the container sat unhealthy while the server logged that it was serving.

The third version does not guess at the image's contents. `minio-init` retries `mc alias set` until
the API answers, which is a real readiness check — it is the first thing that has to work anyway —
and it depends on no binary being present anywhere except the `mc` this project chose. `minio` is
consequently the one long-running service `compose-wait.mjs` passes on `running` alone.

**Alloy** uses `bash`'s `/dev/tcp` — its image ships neither `wget` nor `curl`, a fact discovered by
the healthcheck failing rather than by reading the Dockerfile. It proves Alloy is listening, not that
every component loaded.

**ClickHouse** uses `127.0.0.1`, not `localhost`. It listens on IPv4 only while busybox `wget`
resolves `localhost` to `::1` first, so the `localhost` form is refused from inside the container and
the service never reports healthy.

**Loki** gets twenty retries rather than ten, because it waits on `minio-init` and a cold image pull
makes that slow.

---

## Checking it

```bash
docker compose -f infra/docker-compose.yml --profile '*' config --quiet   # valid?
docker compose -f infra/docker-compose.yml --profile '*' config --services # what would run
docker network inspect lite_default --format '{{range .Containers}}{{.Name}} {{.IPv4Address}}{{"\n"}}{{end}}'
```

`config` resolves variables, applies `.env`, and validates the schema without starting anything — it
is the fastest way to check an edit, and it is what CI should run if this file ever grows.
