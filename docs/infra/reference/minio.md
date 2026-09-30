---
title: minio
description: The S3 stand-in, the one bucket and its three prefixes, and the one-shot container that creates it.
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
| **Bucket** | `ratchet` |

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

## One bucket, three uses

Everything the application stores goes into `ratchet`. The prefix says what an object is.

| Prefix | Written by | Contains | Removed by |
|---|---|---|---|
| `<subject>/…` | `S3StorageGateway` | user uploads | the resource's delete |
| `export/` | the tenant export job | a tenant's export archive | the bucket's lifecycle rule, after 7 days |
| `cold/` | tenant delete | a deleted tenant's archive | the nightly `retention` job, after 30 days |

**Uploads are a genuine second source of truth.** Postgres holds the metadata row and the object
key; MinIO holds the bytes. That is why deleting a resource is two operations, and why the two can
disagree if one half fails ([12](../../setup/12-application-package.md)).

**The bucket carries one lifecycle rule**, on `export/`. The nightly `retention` job converges it:
it reads the bucket's rules and writes the one that should be there. So a fresh MinIO gets the
rule on the first run, with nothing to set up by hand.

**`cold/` is swept by the job, not by a rule.** The job deletes a deleted tenant's archive once
its 30 days are up.

> Upload keys follow `<subject>/<yyyy>/<mm>/<uuid>.<ext>` — date-partitioned because
> lifecycle rules and cost reporting both work on prefixes, and a UUID rather than the original
> filename because filenames are user input.

Lite has no second bucket. The big kit also created `loki`, for log storage, and ran a cold MinIO
tier for lifecycle transitions. Neither is here — see [logs](../../scale/logs.md) and
[retention](../../scale/retention.md).

---

## `minio-init`

A one-shot container, not a service:

```yaml
minio-init:
  image: bitnamilegacy/minio-client:latest
  restart: "no"
  depends_on: [minio]
  entrypoint: >
    /bin/sh -c "
    until mc alias set local http://minio:9000 ratchet ratchetsecret; do sleep 2; done &&
    mc mb --ignore-existing local/ratchet &&
    mc anonymous set none local/ratchet &&
    echo 'buckets ready'
    "
```

It runs, creates the bucket, and exits — so **`exited (0)` in `docker compose ps` is success**, not
a failure. It has `restart: "no"` and no healthcheck, because a container meant to stop cannot
be unhealthy.

**`mc alias set local http://minio:9000`** uses the service name, because this container is on the
bridge network. `localhost` here would be `minio-init`'s own loopback.

**`--ignore-existing`** makes it idempotent, so it is safe on every `up`.

**`mc anonymous set none`** makes the bucket private. That is the correct default: files are served
through presigned URLs from `S3StorageGateway`, never by public path. A public bucket would make
every uploaded document readable by anyone who guessed a key.

Nothing else in compose depends on it. The apps only need the bucket by their first upload, and
`compose-wait.mjs` holds the stack un-ready until `minio-init` has exited.

---

## Checking it

```bash
C="docker compose -f infra/docker-compose.yml"
MC="$C run --rm --entrypoint sh minio-init -c"

# the bucket exists
$MC "mc alias set l http://minio:9000 ratchet ratchetsecret >/dev/null && mc ls l"

# what the application has written
$MC "mc alias set l http://minio:9000 ratchet ratchetsecret >/dev/null && mc ls --recursive l/ratchet | head"
```

The server image ships no `mc`, so these borrow the `minio-init` image. It sits on the network,
so it dials `minio:9000`, not the host port.

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
