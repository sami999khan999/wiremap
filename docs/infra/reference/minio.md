---
title: minio
description: The S3 stand-in, its two unrelated consumers, and the one-shot container that creates both buckets.
---

# `minio`

An S3-compatible object store, running locally so the S3 code path is exercised in development rather
than first executed on the day you deploy.

| | |
| --- | --- |
| **Image** | `coollabsio/minio:RELEASE.2025-10-15T17-29-55Z` |
| **Inside the network** | `minio:9000` |
| **From the host** | `localhost:29000` (API), `localhost:29001` (console) |
| **Credentials** | `ratchet` / `ratchetsecret` |
| **Volume** | `miniodata` |
| **Buckets** | `ratchet`, `loki` |

---

## Why MinIO rather than a filesystem adapter

The AWS SDK talks to MinIO unchanged. A filesystem `StorageGateway` would mean the S3 path — presign
expiry, path-style addressing, multipart, error shapes — is first executed in production.

The one difference is addressing, and it is a config value rather than a code branch:

```ini
S3_FORCE_PATH_STYLE=true    # MinIO: endpoint/bucket/key
S3_FORCE_PATH_STYLE=false   # AWS:   bucket.endpoint/key
```

That switch has been in `.env.example` since [02](../../setup/02-repo-skeleton.md) precisely
so the production difference is one line in an environment file.

---

## Two unrelated consumers

This is the part worth knowing, because the two have nothing to do with each other and share only a
server.

| Bucket | Written by | Contains | Derived? |
|---|---|---|---|
| `ratchet` | `S3StorageGateway` | user uploads | **no** — a second source of truth |
| `loki` | Loki | log chunks and the TSDB index | no — but only 30 days of it |

**`ratchet` holds a genuine second source of truth.** Postgres holds the metadata row and the object
key; MinIO holds the bytes. That is why deleting a resource is two operations, and why the two can
disagree if one half fails ([12](../../setup/12-application-package.md)).

**`loki` is Loki's storage backend**, configured in [loki.config.yml](loki.md). Pointing Loki at
object storage rather than a local volume is what makes retention a config line and what makes the
local topology match production, where the same setting names S3.

> Keys under `ratchet` follow `<subject>/<yyyy>/<mm>/<uuid>.<ext>` — date-partitioned because
> lifecycle rules and cost reporting both work on prefixes, and a UUID rather than the original
> filename because filenames are user input.

---

## `minio-init`

A one-shot container, not a service:

```yaml
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
```

It runs, creates both buckets, and exits — so **`exited (0)` in `docker compose ps` is success**, not
a failure. It has no `restart:` policy and no healthcheck, because a container meant to stop cannot
be unhealthy.

**`mc alias set local http://minio:9000`** uses the service name, because this container is on the
bridge network. `localhost` here would be `minio-init`'s own loopback.

**`--ignore-existing`** makes it idempotent, so it is safe on every `up`.

**`mc anonymous set none`** makes both buckets private. That is the correct default: files are served
through presigned URLs from `S3StorageGateway`, never by public path. A public bucket would make
every uploaded document readable by anyone who guessed a key.

Loki depends on this container *completing*, not merely starting:

```yaml
loki:
  depends_on: { minio-init: { condition: service_completed_successfully } }
```

Without that, Loki starts before its bucket exists and fails on the first write.

---

## Checking it

```bash
C="docker compose -f infra/docker-compose.yml"

# both buckets exist
$C exec minio sh -c "mc alias set l http://localhost:29000 ratchet ratchetsecret >/dev/null && mc ls l"

# Loki is genuinely writing into its bucket
$C exec minio sh -c "mc alias set l http://localhost:29000 ratchet ratchetsecret >/dev/null && mc ls --recursive l/loki | head"
```

`loki_cluster_seed.json` and an `index/` prefix appear as soon as Loki starts. **Chunks take longer**:
Loki buffers them in its write-ahead log and flushes on a timer, so a `fake/` prefix — the tenant name
used when `auth_enabled: false` — only shows up after the first flush, not after the first log line.

An empty `loki` bucket with a healthy Loki means Loki is running but nothing has been shipped to it —
check [alloy](alloy.md). An `index/` but no `fake/` after a few minutes of traffic is normal.

The console at `http://localhost:29001` signs in with the same credentials and is the fastest way to
look at an uploaded object.

> **MinIO stopped publishing community images in October 2025**, and pulled the existing ones from
> Docker Hub and Quay together. `minio/minio` and `minio/mc` both stopped resolving, which took the
> CI stack down with them — the pull failure is a `403` naming a repository that no longer exists,
> not a rate limit, so waiting does not fix it.
>
> The server is now a community rebuild of `RELEASE.2025-10-15T17-29-55Z`, the last upstream release,
> pinned rather than floating: there will be no further releases to track, so a moving tag buys
> nothing and costs the next person an unexplained change. `mc` comes from Bitnami's archive, which
> is frozen for the same reason. Both are stand-ins for a dev dependency — an S3 that is not AWS —
> and neither is something a deployment runs.
