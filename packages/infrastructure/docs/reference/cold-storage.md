---
title: Cold storage
description: Retention stops meaning deletion — the tenant-month as the unit, the cold/ prefix, partition_archive as the index a read starts from, and the restore that proves the difference.
---

# `PgPartitionArchiveGateway`

Retention used to destroy a month. `outbox_event` went at two months, `notifications` at twelve,
and only `activity_log` survived — because one gateway detached it, streamed it to S3 and verified
the object before dropping. This generalises that one mechanism rather than building a second:
**every partitioned table archives before it drops**, `outbox_event` included.

## The unit is the tenant-month

A tenant is a `LIST` partition and its months are `RANGE` partitions underneath, so one tenant's
month is one child table: `activity_log_<32hex>_2026_05`. That is what gets detached, streamed,
recorded, verified and dropped — one child at a time, N of them per table-month.

Two findings decided the shape, and both are worth knowing before reading the code.

**The old archive object was one cross-tenant blob per month.** The key was
`activity-archive/<yyyy>/<mm>/activity_log.ndjson.gz`, holding every organization's rows
interleaved. Serving one tenant their own old rows out of that means downloading and discarding
every other tenant's month, on a user request path. So objects are cut per tenant, which is also
the only layout that could ever be handed to a browser as a presigned URL.

**Retention cannot be per-organization while the partition is shared.** A partition is the unit of
archival *and* of dropping. Per-org retention over a shared partition would mean `DELETE`-ing one
tenant's rows out of it — precisely the bloat-and-vacuum problem partitioning exists to avoid. It
is expressible here only because the tenant-month child made the tenant the partition.

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

**4. Verify** the object is readable and complete. A `HEAD` is not enough: it proves an object
exists, not that its bytes survived.

**5. Only now, drop.**

A month with no rows is detached and dropped with **no object and no row**. That is what makes an
absent `partition_archive` row mean "nothing to restore" rather than "not archived".

## The key, and the one lifecycle rule it buys

```
cold/<table>/<yyyy>/<mm>/<organization_id>.ndjson.gz
```

`cold/` rather than a per-table prefix, because one S3 lifecycle rule on that prefix tiers every
table to Glacier without naming a single object. That is the whole reason `StorageGateway` fixes a
prefix layout at all. The tenant is the leaf, so one tenant's month is one object and the prefix
still covers every tenant.

A table with no tenant level — `outbox_event`, whose drain polls it every second and must not touch
a partition per tenant to do it — writes its month under `PartitionArchiveGateway.NO_TENANT`, the
nil uuid. It names no row, which is what makes an object under it readable as "this one spans every
tenant" rather than as somebody's.

**The rule is per table, and it is composed from a row.** `cold/<table>/` is the prefix a
lifecycle rule matches, and `RetentionRules.lifecycleFor` writes one per `retention_policy` row
that names a cold window. The whole configuration is replaced on every write — S3 offers no
per-rule edit — so the rules are sorted by prefix and compared before anything is applied.

It is per table rather than per tenant-month because **a bucket takes at most a thousand
lifecycle rules**. A tenant whose cold window is shorter than its table's is enforced by the
nightly sweep instead: the per-table rule is the ceiling, and the app does anything tighter. A
tenant whose window is *longer* than the table's cannot be honoured at all, which is why
`update-tenant-retention` says so on the screen rather than saving a number the bucket will
ignore.

Months are converted to days at 30.44 and **rounded up**: rounding down expires an object inside
the window an operator asked for, which is the direction that loses data.

## `partition_archive` is the index a read starts from

```
partition_archive (organization_id, table_name, period) primary key
  object_key, row_count, bytes, checksum, action_counts, projected_at, archived_at
```

Leading with the tenant is not cosmetic: it is what lets one tenant's cold months be read, swept
and totalled without touching another's, and it is why this table needs no `TENANT_EXEMPT` line
where `activity_archive` needed one until `0034` dropped it.

`organization_id` is deliberately **not** a foreign key to `organizations`, for the reason the
audit trail already gives about its actor: an archive record outlives the tenant it names, and a
cascade would erase it. That is also why the sweep below exists rather than a cascade.

Three columns beyond what `activity_archive` carried before it, and each has one reader:

- **`bytes`**, from `StoredObject.size`. Nothing else in this repository records what an object
  costs, so a per-tenant storage total had nowhere to read from.
- **`action_counts`**, `{ "<action>": n }`, counted while the rows stream out and therefore free.
  `activity_log` only; `{}` for a table with no `action` column. It is what lets a cold
  reconciliation subtract an excluded action without reading the object back.
- **`projected_at`**, null meaning the derived store never received this tenant-month. A partial
  index on `(table_name, period) where projected_at is null` makes "what has a hole" an index read
  rather than a scan over every month ever archived.

## What the totals on `/platform/storage` are, and are not

`PgTenantStorageReader` groups `partition_archive` by `(organization_id, table_name)` and sums
`bytes` and `row_count`, so the screen's number is the sum of object sizes S3 reported on the put
— not a `ListObjectsV2` over the bucket, which would be a call per page per tenant and would
disagree with the index the moment a put failed after the upload.

The screen is **cold storage only**, and says so. Hot Postgres bytes cannot be attributed to a
tenant from the catalog: a tenant-month child holds exactly one tenant's rows, but
`pg_total_relation_size` is per relation and a partition parent's size is the sum over children
of every tenant. Hot size per *table* is a different question and lives on the retention screen,
where `partitionsBefore` already returns it.

The join to `organizations` is a **left** join. A deleted tenant's objects outlive its row by
thirty days — the sweep below is what removes them — and an inner join would hide exactly the
rows an operator opened this screen to find. The name column is null for those, and the screen
renders the id instead.

## A gap is recorded, never silent, and never blocks a drop

After a month is archived, `MaintenanceConsumer` asks the projector where each tenant's checkpoint
is. Past the end of the month, it stamps `projected_at`; short of it, or with no projector
configured at all, it emits `analytics.projection.gap` with `reason: "disabled" | "behind"` and
leaves the row null.

The month is archived and dropped either way. A forgotten switch costs a known hole — one an index
read finds and a re-projection closes — rather than an unbounded table.

The gap line is one per table-month, not one per tenant: a month with five thousand tenants would
otherwise be five thousand lines. So is `maintenance.partition.archived`, which carries
`{ table, period, objects, rows }` — `objects` being tenants that had rows, which is not the same
as tenants and not the same as partitions dropped.

## Restore, and why it never re-attaches

`restore(table, period, organizationId)` streams the object, gunzips it as it arrives, and inserts
into a **scratch table** named `<child>_restore` — never straight back into the live parent. A restore that
re-attaches silently puts archived rows back in the hot database and leaves the retention job
arguing with itself about them.

The spec is the point of the method: archive a seeded month, drop it, restore it, and assert the
row count matches what `partition_archive` recorded and that an md5 over the sorted ids matches
what went out. **An archive nobody has restored is a deletion with extra steps**, and this is the
only thing that makes the difference checkable rather than asserted.

The rows are handed to Postgres as one JSON array per batch through
`json_populate_recordset(null::<scratch>, …)`, so the lines never become objects in this process.

**And the month is never whole in memory on the way back either** (`CR.16`). The restore gunzipped
the whole object, turned it into one string and split it: a large month OOMed the worker or passed
V8's string limit, and the synchronous parse held the event loop past the other queues' locks, so
their jobs were redelivered and sent twice. `StorageGateway.getStream` hands the object over by the
chunk, `NdjsonLines` gunzips and splits it as it arrives, and the insert takes a batch at a time.
The compressed bytes are hashed on the way through and the lines counted; a mismatch with the
`partition_archive` row drops the scratch table and throws. The restore had no check at all before.

`ColdArchiveReader.batches` is the same read for the re-projection, with one difference: it proves
the object in a **first pass** and parses it in a second. Rows handed to the projector from an
object found corrupt only at its end would already be in ClickHouse. The archived-notifications
page reads in one pass instead: it keeps only the rows of the page it returns, counts the rest,
and checks the hash and the count at the end, before it returns anything. The 50 MB cap on it stays,
as a bound on how long one request may spend reading rather than on memory.
The scratch table is dropped and recreated rather than appended to: a previous restore of the same
month is evidence of that restore, and two runs merged into one table are evidence of neither.

## Deleting a tenant reaches cold storage

The moment objects are cut per tenant, deleting an organization cascades cleanly through Postgres
and leaves every one of its S3 objects behind. That is a GDPR-shaped hole created by this
mechanism, so this mechanism closes it.

`sweep(organizationId)` reads `partition_archive` for the tenant, `storage.delete()`s each object,
**then** removes the rows — in that order, so a crash leaves a row pointing at a deleted object,
which is re-runnable, rather than an object nothing points at, which is invisible forever.

`DeleteOrganizationUseCase` is the trigger this section was written without. It does **not** call
`sweep`, and the difference is the point: the objects stay for thirty days after the tenant is
gone, because a delete that also destroyed the archive would be unrecoverable at the moment it is
most likely to have been a mistake.

`sweepDeleted(before)` is what ends that window, and it reads a **tombstone**.
`DeleteOrganizationUseCase` calls `markTenantDeleted` before the row goes, stamping `deleted_at`
on every one of that tenant's `partition_archive` rows; the sweep takes the rows whose `deleted_at`
is older than the cutoff **and** whose `organization_id` matches no `organizations` row —
`not exists`, not a left join, because this reads a table that only grows. Per row: delete the
object, then delete the row, so a crash re-runs cleanly. One `cold.objects.swept` line per run,
carrying `reason: "tenant_deleted"` and both counts; nothing at all when there was nothing to sweep.

> [!IMPORTANT]
> **The tombstone is not decoration, and `archived_at` is the wrong column for this.** Keyed on
> the archive time, the window measured how old each *month* was rather than how long ago the
> tenant was deleted. A tenant with a year of cold months had eleven of them already past the
> cutoff, so they were destroyed the night after the delete and only the two months
> `archiveEverything` had just re-written survived — the opposite of what this section promises.
>
> It also destroyed every `outbox_event` archive of every live deployment. That table has no
> tenant level, so its months are recorded under `NO_TENANT`, the nil uuid, which no
> `organizations` row ever matches; `not exists` was therefore true for all of them forever.
> `retention_policy.cold_months` for `outbox_event` was never honoured. A tombstone fixes both at
> once: an outbox row is never stamped, so the sweep never sees it.
> `tests/cold/sweep-deleted.spec.ts` pins both cases.

`sweep(organizationId)` remains the immediate version, and an operator still reaches it by hand
when thirty days is not the answer:

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

Objects under `export/` expire after seven days, by the one lifecycle rule the app writes that is
not composed from a retention row — see
[`storage-policy.md`](storage-policy.md).

## A failure between detach and drop re-attaches

Everything from the detach to the drop runs inside a `try`, **the detach included** (`CR.15`). If `putStream`, the insert or the
verification throws, the child is put back where it was and the original error is rethrown.

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

**A run that is killed never reaches the unwind** — a `SIGTERM` past the drain, an OOM. It left the
month either detach-pending, which made every later run throw before its `try`, or a standalone
table that `childrenOf` never finds again: rows invisible to the app, never archived and never
dropped. So the retention pass calls `recover(table)` on each node **before** it lists months. It
finalizes every detach-pending child, then attaches every table named as a month of this one —
`<parent>_<yyyy>_<mm>` — that is nobody's partition, and emits `cold.partition.recovered` for each.
The month is readable again, and listed, so the same pass archives it. A `_restore` scratch table
does not end in a month and is never matched.

## The unwind stops the stream first, and waits for it

`Readable.from` starts pulling the moment it is piped, so by the time `putStream` rejects the
keyset loop is already paging. Nothing consumes those pages: in production a full scan of the month
that is thrown away, and in the spec a query still in flight when `afterEach` drops the partition —
an unhandled rejection reported beside a green suite rather than as a failure.

So the unwind destroys the gzip stream and its source **and awaits `close`** before re-attaching.
`destroy()` returns before the page already in flight does, and the caller drops the partition the
instant `archive()` throws. Waiting is what makes "no query is outstanding" true rather than likely.

## NDJSON, and paging out of a detached partition

ClickHouse reads NDJSON back with `s3(…, 'JSONEachRow', …)` directly. `row_to_json` produces the
line; the sort column and the id come back beside it so the next page's cursor costs no extra round
trip. The separator is named as a constant because in NDJSON a newline is **data rather than
formatting**, and naming it keeps a formatter from ever treating it as the latter.

Keyset pagination on `(<partition column>, id)`, so a month that does not fit in memory never has
to. `OFFSET` would re-scan everything it already returned.

**The keyset needs an index to walk, and only `activity_log` had one** (`CR.23`). `notifications`
indexes lead with the tenant, and `outbox_event`'s only such index is partial on unpublished rows,
which an archived month has none of. Every page was a scan of the month with a top-N sort: a
30-million-row outbox month is three thousand of them, pages reached the statement timeout, and
retention never finished. A month of more than one page now gets `<child>_walk` on
`(<partition column>, id)`, built on the detached table through the direct pool — one sort instead
of three thousand, and dropped with the table. The unwind and `recover` drop it before attaching, so
a month that goes back carries no index its siblings lack. The predicate is built as a variable
rather than inline: a ternary between two `sql` templates makes the row type infer through `after`,
which `after` is then assigned from — a cycle the compiler reports as an implicit `any`.

The count is taken **after** the detach. Detaching first is what makes the export a closed set, so
counting first would count a different set from the one uploaded: rows written in between would be
streamed to S3 and missing from `row_count`, and that drift is permanent and silent.

## What happened to `activity_archive`

`0025` copied every row of it into `partition_archive` under `table_name = 'activity_log'`, keeping
the object key it already named — the object is where it is, and rewriting the key would have
pointed the index at nothing. The table itself then stayed, on one condition it wrote down: until
no deployment could still hold objects under the old `activity-archive/` prefix.

**`0034` drops it, because that condition is met.** There is no deployment — CI builds and tests
and does not deploy, there are no tags and no releases, and the only bucket this system has ever
written to holds `cold/` and `export/`. No object under the old prefix exists anywhere to orphan.
`shard.ts` no longer names the table, so the catalog exemption that stood in for a `TENANT_EXEMPT`
line went with it.

## The key does not carry the shard, and the index does not grow a column

A tenant lives on one node, so `cold/<table>/<yyyy>/<mm>/<organization_id>.ndjson.gz` is already
unique across the cluster and `partition_archive` already identifies a row by
`(organization_id, table_name, period)`. Putting the shard index in either would record where the
rows were the day they left — and the day that tenant moves, every key and every row would name a
node it is no longer on, with nothing to rewrite them.

What *is* per shard is the loop. The retention pass walks each node, detaching and archiving the
partitions it finds there; the index rows it writes go to the catalog through
`BaseRepository.catalogDb`. See [sharding](sharding.md).

