---
title: Cold storage
description: What a tenant delete leaves in the bucket — the tenant-month as the unit, the cold/ prefix, partition_archive as the index, the 30-day window, and the export that shares the writer.
---

# `PgPartitionArchiveGateway`

**Lite archives a month in one case: a tenant is being deleted.** `PurgeOrganizationUseCase` calls
`archive` for every month of every tenant-level, month-partitioned table before it drops the
tenant's partitions. The objects then stay for thirty days, so a delete that was a mistake still
has its rows in the bucket. Nothing in lite archives or drops a month on the calendar; that is the
big kit's retention, and bringing it back is [Retention](../../../../docs/scale/retention.md).

The gateway does four things: `archive`, `sweep`, `markTenantDeleted` with `sweepDeleted`, and
`exportTenant`.

## The unit is the tenant-month

A tenant is a `LIST` partition and its months are `RANGE` partitions underneath, so one tenant's
month is one child table: `activity_log_<32hex>_2026_05`. That is what gets detached, streamed,
recorded, verified and dropped — one child at a time.

**Objects are cut per tenant.** One cross-tenant blob per month would mean downloading and
discarding every other tenant's rows to hand one tenant theirs. Per tenant is also the only layout
that could ever be given to a browser as a presigned URL.

## The order is the job

```
detach → stream to S3 → record → verify → drop
```

It is the order rather than the steps that matters. **Dropping before verifying is unrecoverable
loss.**

**1. Detach.** `CONCURRENTLY`, so the parent is not locked against writers while it happens — which
is also why the method is not one transaction, since a concurrent detach cannot run inside one.
Detaching first is what makes the export consistent: the child stops receiving rows the instant it
is detached, so what gets uploaded is a closed set.

**2. Stream to S3** as gzipped NDJSON. Compression happens *between* the database and S3 rather
than at either end, so neither ever holds the month in memory. A `Gzip` stream is already an
`AsyncIterable` of chunks, which is why it needs no cast to reach `putStream`.

**3. Record**, before anything is destroyed.

**4. Verify** the object's length against what the upload reported. A `HEAD` that only checks
existence is not enough: a multipart upload that lost a part answers it the same way.

**5. Only now, drop.**

A month with no rows is detached and dropped with **no object and no row**, so an absent
`partition_archive` row means "nothing was there" rather than "not archived".

## The key

```
cold/<table>/<yyyy>/<mm>/<organization_id>.ndjson.gz
```

The tenant is the leaf, so one tenant's month is one object and `cold/` still covers every tenant.
Lite writes **no lifecycle rule on `cold/`**: the only rule is the seven-day one on `export/` (see
[`storage-policy.md`](storage-policy.md)). The thirty-day window is enforced by the nightly sweep
below, not by the bucket.

`PartitionArchiveGateway.NO_TENANT`, the nil uuid, is the organization a table with no tenant level
would record its month under. Lite never archives one — the purge skips `outbox_event` — so no row
carries it today.

## `partition_archive` is the index

```
partition_archive (organization_id, table_name, period) primary key
  object_key, row_count, bytes, checksum, action_counts, projected_at, archived_at, deleted_at
```

Leading with the tenant is what lets one tenant's cold months be read, swept and totalled without
touching another's.

`organization_id` is deliberately **not** a foreign key to `organizations`: an archive record
outlives the tenant it names, and a cascade would erase it. That is why the sweep below exists
rather than a cascade.

- **`bytes`**, from `StoredObject.size`. What an object costs, recorded on the put.
- **`action_counts`**, `{ "<action>": n }`, counted while the rows stream out and therefore free.
  `{}` for a table with no `action` column. Nothing in lite reads it.
- **`projected_at`** is never written in lite. It is the big kit's marker for a tenant-month its
  analytics store received, kept so the table matches when [Analytics](../../../../docs/scale/analytics.md)
  comes back.
- **`deleted_at`** is the tombstone the sweep reads.

## Deleting a tenant, and the thirty days after

The moment objects are cut per tenant, dropping an organization's partitions would leave every one
of its S3 objects behind. That is a GDPR-shaped hole, so the gateway closes it.

`sweep(organizationId)` reads `partition_archive` for the tenant, `storage.delete()`s each object,
**then** removes the rows — in that order, so a crash leaves a row pointing at a deleted object,
which is re-runnable, rather than an object nothing points at, which is invisible forever.

`PurgeOrganizationUseCase` does **not** call `sweep`, and the difference is the point: the objects
stay for thirty days after the tenant is gone, because a delete that also destroyed the archive
would be unrecoverable at the moment it is most likely to have been a mistake.

`sweepDeleted(before)` is what ends that window, and it reads a **tombstone**. The purge calls
`markTenantDeleted` before the row goes, stamping `deleted_at` on every one of that tenant's
`partition_archive` rows. The nightly `retention` job sweeps the rows whose `deleted_at` is older
than thirty days **and** whose `organization_id` matches no `organizations` row — `not exists`, not
a left join, because this reads a table that only grows. Per row: delete the object, then delete
the row, so a crash re-runs cleanly. One `cold.objects.swept` line per run, carrying
`reason: "tenant_deleted"` and both counts; nothing at all when there was nothing to sweep.

> [!IMPORTANT]
> **`archived_at` is the wrong column for this.** Keyed on the archive time, the window would
> measure how old each *month* is rather than how long ago the tenant was deleted. A row with no
> tombstone is never swept, which is also what keeps a `NO_TENANT` row safe: no `organizations` row
> ever matches the nil uuid. `tests/cold/sweep-deleted.spec.ts` pins both cases.

`sweep(organizationId)` remains the immediate version, and an operator reaches it by hand when
thirty days is not the answer:

```bash
pnpm db:partitions --sweep <organization_id>
```

## An export is the same writer, pointed at live rows

`exportTenant(organizationId, day)` reuses the NDJSON-and-gzip path above and changes one thing:
it reads **live** rows rather than a detached partition. An export must not take the tenant's data
offline, so there is no detach, no drop, and no `partition_archive` row — the objects are a copy,
not the archive.

One object per tenant-owned table under `export/<organization_id>/<yyyy-mm-dd>/<table>.ndjson.gz`,
plus one per catalog table, plus a `manifest.json` carrying every object's row count, byte size
and checksum. A table the tenant has no rows in gets **no object**: the row count is only known
once the stream has drained, so the upload happens and the empty object is deleted, which is
cheaper than counting the table twice.

The keyset is one column — `id` for every table but `role_permissions`, whose primary key is
`(organization_id, role_id, permission)` and which has no `id` at all. `OFFSET` would re-scan the
table once per page and skip rows written in between, which on a live table is not a theoretical
problem.

`invitations.token_hash` and `api_keys.token_hash` are nulled, by re-serialising the row rather
than replacing text in the JSON: a hash is base64, and a naive replace would also hit a column
that happened to contain it.

Objects under `export/` expire after seven days, by the one lifecycle rule the app writes — see
[`storage-policy.md`](storage-policy.md).

## A failure between detach and drop re-attaches

Everything from the detach to the drop runs inside a `try`, **the detach included** (`CR.15`). If
`putStream`, the insert or the verification throws, the child is put back where it was and the original error is rethrown.

Without that, a failed run left the partition **neither attached nor archived**: its rows invisible
to every query against the parent, and nothing to put them back but an operator who knew to look.

```ts
sql.raw(`alter table ${parent} attach partition ${name} for values from ('${from}') to ('${to}')`)
```

`sql.raw`, because **Postgres accepts no bind parameters in DDL** — the same trap
`PgMaintenanceGateway` documents. Both bounds are derived from a `Date`, so there is no injection
surface, and the table name comes from `PartitionedTableName`, a closed union, which is the
injection boundary decision D37 names.

A cancelled `detach … concurrently` leaves the partition *detach-pending*: still a child, so
`attach` is not the inverse, and no row in the month can be read or written. The unwind checks
`inhdetachpending` and runs `detach … finalize` first.

The re-attach swallows its own failure on purpose: the caller needs the error that started the
unwind, and a partition that will not go back is an operator's problem either way.

**A run that is killed never reaches the unwind** — a `SIGTERM` past the drain, an OOM. The big
kit's retention pass ran a `recover` first to put such a month back; lite has none. After a purge
job that died mid-run, look for a detach-pending or standalone `<table>_<32hex>_<yyyy>_<mm>` before
retrying it.

## The unwind stops the stream first, and waits for it

`Readable.from` starts pulling the moment it is piped, so by the time `putStream` rejects the
keyset loop is already paging. Nothing consumes those pages: in production a full scan of the month
that is thrown away, and in the spec a query still in flight when `afterEach` drops the partition —
an unhandled rejection reported beside a green suite rather than as a failure.

So the unwind destroys the gzip stream and its source **and awaits `close`** before re-attaching.
`destroy()` returns before the page already in flight does, and the caller drops the partition the
instant `archive()` throws. Waiting is what makes "no query is outstanding" true rather than likely.

## NDJSON, and paging out of a detached partition

One JSON object per line, which most tools read back directly. `row_to_json` produces the
line; the sort column and the id come back beside it so the next page's cursor costs no extra round
trip. The separator is named as a constant because in NDJSON a newline is **data rather than
formatting**, and naming it keeps a formatter from ever treating it as the latter.

Keyset pagination on `(<partition column>, id)`, so a month that does not fit in memory never has
to. `OFFSET` would re-scan everything it already returned.

**The keyset needs an index to walk, and only `activity_log` had one** (`CR.23`). `notifications`
indexes lead with the tenant, and `outbox_event`'s only such index is partial on unpublished rows,
which an archived month has none of. Every page was a scan of the month with a top-N sort: a
30-million-row month is three thousand of them, and pages reached the statement timeout. A month
of more than one page now gets `<child>_walk` on `(<partition column>, id)`, built on the detached table through the direct pool — one sort instead
of three thousand, and dropped with the table. The unwind drops it before attaching, so
a month that goes back carries no index its siblings lack. The predicate is built as a variable
rather than inline: a ternary between two `sql` templates makes the row type infer through `after`,
which `after` is then assigned from — a cycle the compiler reports as an implicit `any`.

The count is taken **after** the detach. Detaching first is what makes the export a closed set, so
counting first would count a different set from the one uploaded: rows written in between would be
streamed to S3 and missing from `row_count`, and that drift is permanent and silent.

## The key does not carry the shard, and the index does not grow a column

A tenant lives on one node, so `cold/<table>/<yyyy>/<mm>/<organization_id>.ndjson.gz` is already
unique across the cluster and `partition_archive` already identifies a row by
`(organization_id, table_name, period)`. Putting the shard index in either would record where the
rows were the day they left, which stops being true the day a tenant's placement changes.

What *is* per shard is where it runs. The gateway is `local`: the purge runs placed on the tenant's
node and detaches the partitions it finds there, and the index rows go to the catalog through
`BaseRepository.catalogDb`. See [sharding](sharding.md).

