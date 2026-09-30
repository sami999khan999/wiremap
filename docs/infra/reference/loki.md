---
title: loki.config.yml
description: Every block of Loki's config — single-binary mode, MinIO-backed storage, thirty-day retention, and the two settings that stop it inventing labels.
---

# `loki.config.yml`

The log store. Alloy pushes to it, MinIO holds its chunks, and everything that reads goes through its
HTTP query API — `curl`, the smoke check, and
[`LokiLogReader`](../../../packages/infrastructure/docs/reference/loki.md), which is the seam the
super-admin dashboard will read through.

**Nothing in this repository pushes to it.** `JsonLogger` writes to stdout and has never heard of
Loki; Alloy tails stdout and pushes. That asymmetry is why swapping the log platform is a config
change — the write path has no dependency to swap.

| | |
| --- | --- |
| **Image** | `grafana/loki:3.3.2` |
| **Inside the network** | `loki:3100` |
| **From the host** | `localhost:23100` |
| **Volume** | `lokidata` — index and WAL only |
| **Chunks** | MinIO, bucket `loki` |
| **Retention** | 30 days |

---

## `auth_enabled: false`

Loki is multi-tenant by design and identifies tenants with an `X-Scope-OrgID` header. Disabling auth
does not remove tenancy — it hard-codes every request to the tenant `fake`, which is why objects
appear under `fake/` in the bucket.

For a single-tenant local stack that is correct. **Turning it on means every client must send the
header**, including Alloy's `loki.write` and every query client.

---

## `server`

```yaml
server:
  http_listen_port: 3100
  log_level: warn
```

`warn` rather than the default `info`, and it is a deliberate loop-breaker: Alloy collects Loki's own
stdout, so a chatty Loki generates lines that are shipped back to Loki. At `info` that is a
meaningful fraction of a quiet stack's log volume.

---

## `common`

```yaml
common:
  instance_addr: 127.0.0.1
  path_prefix: /loki
  replication_factor: 1
  ring:
    kvstore:
      store: inmemory
```

This block is what makes Loki run as a **single binary** rather than a distributed system. Loki is
internally a set of components — distributor, ingester, querier, compactor — that in a cluster
discover each other through a ring backed by Consul or etcd.

`store: inmemory` with `replication_factor: 1` means the ring exists but has one member, so all
components run in one process and coordinate through memory. `instance_addr: 127.0.0.1` is how that
member registers itself.

`path_prefix: /loki` is the container path everything local hangs off — the WAL, the index cache, the
compactor's working directory. It is the mount point of the `lokidata` volume.

> Scaling past one instance means replacing this block, not editing it. Grafana Cloud runs the same
> Loki with a real ring, which is why the escape hatch is a config change rather than a migration.

---

## `common.storage.s3` — chunks in MinIO

```yaml
  storage:
    s3:
      endpoint: minio:9000
      bucketnames: loki
      access_key_id: ratchet
      secret_access_key: ratchetsecret
      s3forcepathstyle: true
      insecure: true
```

**`endpoint: minio:9000`** is the service name on the bridge network — see
[minio](minio.md). Not `localhost`, which would be Loki's own loopback.

**`s3forcepathstyle: true`** is the same distinction as `S3_FORCE_PATH_STYLE` in `.env.example`:
MinIO addresses buckets as `endpoint/bucket/key`, AWS as `bucket.endpoint/key`. Both values flip for
real S3.

**`insecure: true`** means plain HTTP. MinIO here has no TLS; against real S3 this is removed.

Pointing Loki at object storage rather than a local volume is what makes retention a config line, and
what makes the local topology match production where the same block names S3 and a real key.

---

## `schema_config`

```yaml
schema_config:
  configs:
    - from: 2024-01-01
      store: tsdb
      object_store: s3
      schema: v13
      index:
        prefix: index_
        period: 24h
```

**A list, not an object, and that is structural.** Loki's storage format has changed across versions,
and rather than migrate old data it keeps a *dated list of schemas*: data written after `from` uses
that entry, older data keeps whatever was current when it was written. Changing the format means
appending an entry with a future `from`, never editing this one.

`store: tsdb` with `schema: v13` is the current pair — TSDB is the index format Loki 3.x wants, and
v13 is the schema version that goes with it. `period: 24h` means one index table per day, which is
also the granularity the compactor works at.

---

## `limits_config`

```yaml
limits_config:
  retention_period: 720h
  reject_old_samples: true
  reject_old_samples_max_age: 168h
  max_label_names_per_series: 8
  discover_service_name: []
  discover_log_levels: false
```

**`retention_period: 720h`** is the thirty-day policy, and it is the entire argument for a log
platform over a log table. No migration, no partition, no cleanup job.

**`reject_old_samples`** refuses lines older than a week. Without it, a misconfigured agent replaying
an old file writes into arbitrary past index periods, which is expensive and confusing.

**`max_label_names_per_series: 8`** is a backstop, not the rule. The rule is the four-label pipeline
in [alloy](alloy.md); this makes a mistake fail loudly at ingest rather than quietly multiplying
streams.

### The two that stop Loki inventing labels

```yaml
  discover_service_name: []
  discover_log_levels: false
```

**Loki 3.x adds labels on its own unless told not to.** By default it derives a `service_name` from a
list of candidate fields, and detects a `detected_level` from the line. Left at their defaults, the
label set the Alloy pipeline carefully limits to four arrives as six.

This was found by querying the running system, not by reading the config — nothing in
`alloy.config.alloy` mentions `service_name`, so a config review cannot find it. It is one of the
three reasons the gate checks live labels rather than the file.

---

## `compactor`

```yaml
compactor:
  working_directory: /loki/compactor
  delete_request_store: s3
  retention_enabled: true
```

**`retention_enabled: true` is what actually enforces `retention_period`.** Without it the setting is
advisory — Loki accepts the limit and nothing ever deletes. The compactor is the component that
merges index files and applies deletion, and it must be explicitly told retention is its job.

`delete_request_store: s3` puts pending deletion requests in the object store, so they survive a
restart.

---

## Who talks to it

| Direction | Who | How |
|---|---|---|
| in | `alloy` | `POST http://loki:3100/loki/api/v1/push` |
| out | `LokiLogReader` | `GET http://loki:3100/loki/api/v1/query_range` |
| out | you | `curl localhost:23100/loki/api/v1/...` |
| storage | `minio` | chunks and index to bucket `loki` |

`LokiLogReader` is built only when `LOKI_URL` is set, and its absence changes nothing about what is
written. It is also deliberately **not** part of `Container.healthy()`: Loki being down loses
diagnostics and nothing else, and failing a readiness probe over it takes the application down in
order to protect its logs.

Its `LogQuery` type offers the four labels and a substring filter, and nothing else — so a caller
cannot express a query that would need a high-cardinality label. The cardinality rule below is
enforced by the shape of the port rather than by convention.

---

## Checking it

```bash
curl -s http://localhost:23100/ready          # "ready"
curl -s http://localhost:23100/config | head  # what it actually loaded, after defaults

# the label set — query a FRESH window, not the global list
curl -s -G http://localhost:23100/loki/api/v1/series \
  --data-urlencode "start=$(($(date +%s)-60))000000000" \
  --data-urlencode 'match[]={app=~".+"}'
```

**The global `/labels` endpoint includes streams from before any config change** and will show ghosts
long after the cause is fixed. Always scope to a fresh window when checking cardinality.

The application-side check is `pnpm --filter @loadbearing/infrastructure run smoke` with `LOKI_URL`
set: it pings `/ready` and runs a real `query_range` over the last hour, printing what came back. It
deliberately asserts nothing about a particular line — that would make the check depend on something
having been logged recently, which is a flaky test rather than a wiring check.

> Loki takes longer than everything else to report healthy on a cold start, because it waits for
> `minio-init` to create its bucket. Twenty retries at ten seconds is generous on purpose.
