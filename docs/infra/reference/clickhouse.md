---
title: clickhouse.init.sql
description: The analytics store that is defined and deliberately not running — the schema, every clause in it, and the trigger that would start it.
---

# `clickhouse`

Behind the `analytics` profile, and **not** started by `pnpm infra:up`. That is a decision rather
than an oversight.

| | |
| --- | --- |
| **Image** | `clickhouse/clickhouse-server:24.12-alpine` |
| **Inside the network** | `clickhouse:8123` (HTTP), `clickhouse:9000` (native) |
| **From the host** | `localhost:28123`, `localhost:29002` |
| **Credentials** | `ratchet` / `ratchet`, database `ratchet` |
| **Volume** | `clickhousedata` |
| **Config file** | `clickhouse.init.sql` |

**The native port maps to 9002 on the host** because MinIO owns 9000. A collision there produces a
container that starts, binds nothing useful, and fails at connect time with an error naming neither
service.

---

## Why it exists and why it is stopped

[Data and scale](../../opinions/data-and-scale.md) commits to ClickHouse eventually and is
explicit about when: *"do not do this week."* Its five-thousand-employee topology has no ClickHouse
in it at all.

**Today nothing reads an analytics store at all.** Half a million rows a year is a Postgres table
with a good index, and no screen in the kit asks a question that needs more. The kit used to ship an
`AnalyticsReader` port with implementations over both stores; nothing called it, and it was deleted
([12](../../setup/12-application-package.md)).

**The write side is finished; the deployment side is off.**
`ClickHouseAnalyticsProjector`, the worker's projection consumer and the nightly reconciliation all
exist and are covered by the smoke check — see
[the package reference](../../../packages/infrastructure/docs/reference/clickhouse.md). What is off is
this container and the two environment variables that reach it.

That is the distinction worth holding: *the seam being implemented* and *the store being started* are
two different decisions, and only the second one costs anything to be wrong about.

Leaving it *running* with nothing writing to it would be worse than not having it:

> **A running analytics store with nothing writing to it looks like a decision somebody made.** The
> next person assumes it is load-bearing, and the rebuild story quietly stops being true.

Which is why `CLICKHOUSE_URL` is unset in `.env.example` even though the adapter is written. Starting
the container is `pnpm infra:up:analytics`; *feeding* it is that variable, and the two are separate on
purpose.

**The trigger is specific:** snapshots stop covering ad-hoc queries. Not "the table is large", not
"ClickHouse would be faster" — the moment the questions being asked are ones no precomputed rollup
answers.

---

## Starting and stopping it

```bash
pnpm infra:up:analytics
docker compose -f infra/docker-compose.yml --profile analytics stop clickhouse
```

`pnpm infra:down` and `infra:reset` pass `--profile "*"` so they do reach it. A plain
`docker compose down` does not — Compose only acts on profiles it was given, and ClickHouse survives
as a container nobody remembers starting.

---

## `clickhouse.init.sql`

```sql
CREATE TABLE IF NOT EXISTS ratchet.activity_events
(
  id              UUID,
  organization_id UUID,
  occurred_at     DateTime64(3),
  actor_id        UUID,
  action          LowCardinality(String),
  subject_id      Nullable(UUID),
  payload         String
)
ENGINE = ReplacingMergeTree
PARTITION BY toYYYYMM(occurred_at)
ORDER BY (organization_id, occurred_at, id)
TTL toDateTime(occurred_at) + INTERVAL 5 YEAR;
```

Mounted at `/docker-entrypoint-initdb.d/01-schema.sql`, and it is the only table the file creates.
Two rollup tables used to sit beside it, mirroring a Postgres pair column for column; both were
empty in both stores and answered a port nothing called, so all four were dropped.

### `ratchet.` is qualified on purpose

ClickHouse's entrypoint runs the scripts in that directory against **`default`**, not against
`CLICKHOUSE_DB`. An unqualified `CREATE TABLE` therefore succeeds in the wrong database and the table
looks missing — verified by it happening here.

### `ENGINE = ReplacingMergeTree`

ClickHouse's table engines are not interchangeable the way a storage engine usually is. `MergeTree`
is the family that supports partitioning, sorting keys and TTL — the three clauses below all require
it. `Log` or `Memory` would accept the columns and none of the behaviour.

**`Replacing`, specifically, is what makes the projection idempotent.** Rows sharing a sorting key
collapse to one at merge time, and the sorting key ends in the `activity_log` id — so a batch BullMQ
redelivers overwrites the rows it already wrote instead of doubling them.

That is not an optimisation. BullMQ *will* redeliver, so a plain `MergeTree` here would mean a retry
after a partial failure silently double-counts a day, and the nightly reconciliation would report
drift the projection itself caused.

> [!IMPORTANT]
> **Deduplication happens at merge time, not at insert time.** A `SELECT` issued before the parts
> merge still sees both copies. Every query that counts rows uses `FINAL` for exactly this reason —
> otherwise the reconciliation reports drift that will resolve itself in a few minutes, and a false
> alarm on that check is how a real one stops being read.

### `id`, the first column

The `activity_log` primary key, carried across. It is what the dedup key ends with, and what
`AnalyticsProjector.checkpoint()` reads back to resume a replay — the projection stores its cursor in
the destination table rather than beside it, because a cursor kept elsewhere can disagree with what
actually landed.

### `PARTITION BY toYYYYMM(occurred_at)`

One partition per month. **Dropping old data becomes a metadata operation** rather than a scan, and a
query with a date range reads only the partitions it needs.

This is the same reasoning as the monthly partitioning on Postgres's `activity_log`
([13](../../setup/13-infrastructure-postgres.md)) — the difference is that ClickHouse does it natively
rather than needing hand-written DDL.

### `ORDER BY (organization_id, occurred_at, id)`

**The sorting key, and in `MergeTree` it is also the primary index — and under `ReplacingMergeTree`
it is the deduplication key as well.** Data is stored physically in this order, ClickHouse keeps a
sparse index over it, and rows sharing the whole tuple collapse at merge time.

**It leads with `organization_id` for the same reason every Postgres index does:** it is the tenant
boundary, and an analytics store that cannot cheaply answer a question for one organization is not
useful. `occurred_at` second, because every analytics question is a time range. `id` last, and it is
there to make the tuple unique — a dedup key that stopped at `occurred_at` would collapse two
unrelated audit rows written in the same millisecond into one.

`action` used to sit second and was moved out entirely. Filtering by activity type is common, but it
cannot be in the dedup key without pinning it: an `action` in the sorting key means correcting a
mislabelled row creates a second row rather than replacing the first.

Reordering these is not a tuning tweak — it changes physical layout, changes what deduplicates, and
requires a rewrite.

### `LowCardinality(String)` on `action`

Stores the column as a dictionary of distinct values plus an index into it. `action` is a closed
vocabulary — `task.reactivated`, `rbac.role.granted` — so the dictionary is small and both storage
and filtering get much cheaper.

**The same cardinality argument as the Loki label set, one layer down.** Applying it to a
high-cardinality column such as `actor_id` would make things worse, which is why only `action` has it.

### `TTL ... INTERVAL 5 YEAR`

Rows expire after five years, dropped a whole partition at a time.

**Five years here against Postgres's twelve-to-twenty-four months *is* the reason the store exists.**
Postgres keeps detail for as long as an operator needs to read a row; the column store keeps
aggregates for as long as the business needs a trend.

### `payload String`

JSON as text rather than a typed column. ClickHouse has JSON handling, and committing to a shape here
would couple the analytics store to whatever the activity payload looks like today — the opposite of
a store that can be dropped and rebuilt.

---

## Init scripts run exactly once

Like Postgres, scripts in `/docker-entrypoint-initdb.d` run **only when the data directory is empty**.
Editing this file and restarting does nothing.

```bash
docker volume rm lite_clickhousedata     # then start again
```

---

## The two guards that keep it derived

Purely derived is what makes ClickHouse a performance decision rather than a correctness one. It stays
that way only if both hold — **and both are implemented**, which they were not when this page was
first written:

- **Nothing writes to it except the projection.** `ClickHouseAnalyticsProjector` is the only class in
  the repository that inserts, and it is reachable only from the worker. No request path can reach
  ClickHouse at all today. No direct writes from use-cases, no manual backfills that are not replays.
- **A daily reconciliation job** comparing row counts per day against the activity log. That is
  `analytics-reconcile`, at 05:00, over the last seven days. The realistic failure is not an outage —
  it is a consumer that died quietly on a Tuesday and a quarterly report that looks wrong in March.

Both live in
[the package reference](../../../packages/infrastructure/docs/reference/clickhouse.md), which is where
the mechanics are; this page is about the container they run against.

**The way it stops being derived:** a KPI computed in a materialized view and stored nowhere else. At
that point it is authoritative, the rebuild story is gone, and nobody decided it. This is a live
temptation rather than a hypothetical one — a materialized view over `activity_events` is an
afternoon's work, and the first dashboard to want one will not naturally ask where it could be
rebuilt from.

---

## Checking it

```bash
curl -s http://localhost:28123/ping

curl -s "http://localhost:28123/?user=ratchet&password=ratchet" \
  --data-binary "SELECT database, name, engine FROM system.tables WHERE name = 'activity_events' FORMAT TSV"

curl -s "http://localhost:28123/?user=ratchet&password=ratchet" \
  --data-binary "SELECT partition_key, sorting_key FROM system.tables WHERE database = 'ratchet' AND name = 'activity_events' FORMAT TSV"
```

The database must be **`ratchet`**, not `default`. If it is `default`, the init script ran before the
qualification was added — drop the volume and start again.  The engine must be
**`ReplacingMergeTree`**: a plain `MergeTree` there is an init script from before the projection
existed, and it will double-count the first time a job is redelivered.

The end-to-end check is `pnpm --filter @loadbearing/infrastructure run smoke` with `CLICKHOUSE_URL`
set. It inserts the same row twice and expects to read back one — the dedup claim above, tested
rather than asserted.

> **The healthcheck uses `127.0.0.1`, not `localhost`.** ClickHouse listens on IPv4 only while busybox
> `wget` resolves `localhost` to `::1` first, so the `localhost` form is refused from inside the
> container and the service never reports healthy.
