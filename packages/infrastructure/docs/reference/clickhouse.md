---
title: ClickHouse
description: The derived analytics store — two adapters, one connection, and the two guards that keep it rebuildable rather than authoritative.
---

# ClickHouse

The only store in this repository that is allowed to be wrong. Everything in it is a replay of
`activity_log`: drop the whole database, run the projection from an empty checkpoint, and the rows
come back.

**That property is the entire design.** It is what makes adopting ClickHouse a performance decision
rather than a correctness one, and it survives exactly as long as the two guards below hold.

| | |
| --- | --- |
| **Folder** | `packages/infrastructure/src/clickhouse/` |
| **Ports** | `AnalyticsProjector` (write). There is no read port — see below |
| **Config** | `analytics.clickhouse` on `ContainerConfig`; `CLICKHOUSE_*` in the environment |
| **Container** | `container.projector`, `container.hasProjector` |
| **Compose** | `--profile analytics`, stopped by default |
| **Dependency** | none — `fetch` against the HTTP interface |

---

## No client library

`ClickHouseConnection` is `fetch` over ClickHouse's HTTP interface, not `@clickhouse/client`. Same
call `OpenAiEmbeddingProvider` makes, for the same reasons: the request shape is stable, the
dependency count stays where it is, and ClickHouse stays a
[Tier 0](../../../../docs/opinions/dependencies.md) dependency reached over a protocol this runtime
already speaks. Wanting the SDK's connection pooling later is a change inside one class.

Three things it does that are easy to get wrong by hand:

**Parameters are bound server-side, never interpolated.** ClickHouse reads `{name:Type}` placeholders
out of `param_*` query-string entries. The analytics store holds every tenant's rows in one table, so
an injected predicate here is a cross-tenant read — this is the one place in the package where string
interpolation into SQL would be a security bug rather than a style one.

> [!IMPORTANT]
> **An array parameter is the exception, and it is the one that needed escaping.** A scalar rides its
> own query-string entry and is never quoted, so nothing in it can end anything. An array has to be
> sent as a literal — `['a','b']` — and `encode()` built that by wrapping each element in quotes with
> no escape, so an element containing `'` closed its own string and became two. Not a route into the
> statement, which is still bound: a route into the *value*, where a filter list silently matches rows
> the caller never named. `escape()` handles `\` first and then `'`, in that order, because the other
> order escapes its own escape.

**Table names are qualified against the configured database on the way out.** ClickHouse resolves an
unqualified name against the session default, which is `default` unless every request says otherwise.
That is the same trap the `0000` migration documents at the top, and the reason a table can look
missing while it exists.

**`DateTime64(3)` is `YYYY-MM-DD HH:MM:SS.mmm`.** An ISO string's `T` and `Z` are rejected. That
failure is at least loud — a 400 with a parse error — unlike the alternative of a silently wrong hour.

**The response body is logged, never thrown.** The status is usually a bare 500 and the body is the
whole message — so the body goes to `dependency.request.failed` at **warn**, truncated at 500
characters, and the caller gets `UnavailableError("clickhouse", status)`. It cannot be carried on the
error: `AppError.toJSON()` serialises `ErrorContext` to the client, and a failed `INSERT` echoes the
offending row.

---

## Two adapters: one writes, and one only reads

`ClickHouseAnalyticsProjector` writes, and is reachable only from the worker's schedules.
`ClickHouseAnalyticsReader` only reads, and is what a request path reaches — `23.14`.

**The reader came back with a caller this time.** `/analytics` shows a tenant what happened in it,
per day and per action, over 30 or 90 days. `GetActivityTrendUseCase` asserts
`analytics.activity.read`, which `owner` and `admin` hold, and hands the reader the principal's
tenant. The four decisions the entry carried hold. It is a new port, `AnalyticsReader`, in
`application/src/analytics/`. It has no write method. The tenant arrives resolved. Days are ISO
`YYYY-MM-DD` in UTC. **It reads `FINAL`**, as the reconciliation does: the projection is
at-least-once and the table is a `ReplacingMergeTree`, so an unmerged redelivery counts twice
without it. `analytics-reader.smoke.spec.ts` proves that on the running store. Without ClickHouse
the use case answers `configured: false`, and the screen says so rather than drawing an empty
chart. There is still no driver flag: one implementation, and a flag comes back only with a second.

There used to be a second adapter. `ClickHouseAnalyticsReader` answered two dashboard questions
beside a Postgres twin, behind an `AnalyticsReader` port, with `ANALYTICS_DRIVER` choosing between
them — and nothing ever called either one, so the port, both adapters and the flag were deleted.
The projector is the half that has a consumer.

**Keeping them separate classes still matters when the reader returns**, because a single class with
both would put `project()` on the object a dashboard query holds. That split is the first guard:
*nothing writes to ClickHouse except the projection consumer* — no direct writes from use-cases, no
hand-run backfills that are not replays.

---

## The projection, and why it reads its own checkpoint

```
activity_log ──► PgActivityReplayReader ──► ClickHouseAnalyticsProjector ──► activity_events
  (Postgres,          keyset on                ReplacingMergeTree               (derived)
   authoritative)     (occurred_at, id)        keyed on id
```

`checkpoint()` reads `max(occurred_at)` and the id that carries it **out of the destination table**,
not out of a cursor kept beside it.

A checkpoint stored in Postgres or Redis can disagree with what actually landed — the batch that was
acknowledged and then failed to insert — and the disagreement is silent. Asking the table what its own
last row is cannot be wrong in that direction.

Two details that are load-bearing:

**The keyset is `(occurred_at, id)`, not `occurred_at` alone.** Two audit rows can share a
microsecond. A cursor carrying only a timestamp either drops the second row (`>`) or replays the first
forever (`>=`); the tuple comparison does neither.

**An empty table answers with ClickHouse's zero value, not null.** That is 1970, and taken literally
it would make a first run resume *after* every row ever written. The projector checks for it.

`project()` is idempotent because `activity_events` is a `ReplacingMergeTree` whose sorting key ends
in `id`. BullMQ redelivers, so this is not optional — and `dailyCounts` reads with `FINAL` so a
duplicate that has not merged yet is not counted twice. A reconciliation that reports drift because of
an unmerged part is a false alarm, and a false alarm on this check is how a real one stops being read.

**Batches are large and the run is capped.** 5,000 rows per round trip, 20 batches per run: ClickHouse
merges on write, so a thousand single-row inserts create a thousand parts the background merge never
catches up with. The per-run cap bounds how long one job holds a Postgres connection — the first run
after a long outage stops, and the next tick resumes from the checkpoint.

---

## Reconciliation, the second guard

The realistic failure is not an outage. It is a consumer that died quietly on a Tuesday and was
noticed a quarter later, when a report looked wrong.

`AnalyticsConsumer.reconcile()` runs nightly, asks both stores for row counts per day over the last
week, and diffs them. Neither store reaches into the other: each answers the same question in the same
shape and the consumer compares the answers, which is what keeps both adapters single-store.

**Today is excluded from the window.** It is still being written to, so a difference in it is timing
rather than drift, and a check that cries wolf daily is a check nobody reads.

**So are the actions `projection_policy` excludes, on both sides.** `AnalyticsConsumer` reads that
list once per run and passes it to all three queries — `since`, and both `dailyCounts`. Subtracted
from the source only, every excluded row would read as drift on the run after it was excluded, and
on every run after that: a reconciliation that cries wolf forever, which is the same failure the
paragraph above avoids for a different reason.

`since` applies it **in the query**, not after. Filtered in the caller, a page of excluded rows
still costs a round trip and comes back short of `limit`, which the walk reads as caught up. The
ClickHouse side binds it as `{excluding:Array(String)}` — `NOT IN` an empty array is true for
every row, so the empty case needs no branch — and the Postgres side omits the predicate entirely,
because drizzle renders `not inArray(column, [])` as a clause that matches nothing.

Drift emits `analytics.reconciliation.drifted` at **error**, one line per day rather than one line
listing them — a log field is something you filter and alert on, never a structure you read, and the
day is the grain an operator picks a replay window from. It is `error` and not `warn` because every
number a dashboard has shown since the first drifting day is wrong, and the fix is a replay, which
only works while `activity_log` still covers the window. **The alert has a deadline attached.**

**And the window has a cold half.** `activity_log`'s hot months are thirteen and its cold months
are years, so the day-by-day diff above sees none of what has been archived. `reconcileCold`
closes that: for each archived month of a tenant, `partition_archive.row_count` minus the excluded
actions' counts from `action_counts` — which is what that column is for — against this store's
own counts summed over the month.

Two things make it cheap and quiet. It is **one query per tenant over the whole archived range**,
bucketed by month here, rather than a round trip per month on a nightly job. And a month whose
`projected_at` is null is **skipped**: a known gap is not drift, the Gaps panel already says so,
and a second alert would repeat it with a deadline attached.

The line carries `source: "hot" | "cold"`, because the two have different replay sources: a hot
day replays from `activity_log`, and a cold month replays from S3 through the Gaps panel.

Past that window the replay source is [`partition_archive`](cold-storage.md) and the objects
`PgPartitionArchiveGateway` wrote to S3, which is why that gateway exists at all. The key has a
shape now — `cold/activity_log/<yyyy>/<mm>/<organization_id>.ndjson.gz`, one object per tenant per
month — so a replay for one tenant reads one object rather than downloading every other tenant's
month and discarding it. `projected_at` on that row is the other half: null means this store never
received that tenant-month, and the partial index over it is how you find every such hole without
a scan.

---

## The TTL is one expression, and two things about it are not obvious

`RetentionRules.clickhouseTtlFor(defaultMonths, perAction)` composes the whole clause: one
`toDateTime(occurred_at) + toIntervalMonth(n) WHERE action = '…'` per action with its own window,
then the default with `WHERE action NOT IN (…)` over exactly those actions. Sorted by action, so
two runs over the same rows compose the same string — an unstable order would make the nightly
comparison rewrite a years-deep table every night.

**The `NOT IN` is load-bearing, not tidiness.** A TTL clause with no `WHERE` matches every row,
including the ones a longer per-action clause was keeping, and ClickHouse applies whichever
expires first. Without the guard, `TTL … toIntervalMonth(120) WHERE action = 'role.created',
… toIntervalMonth(12)` deletes the four-year-old `role.created` row on the next merge. The
per-action rule reads as honoured and is not.
`tests/smoke/analytics.smoke.spec.ts` proves it against the running container in the only way it
can be proved: insert the row, force a merge, count what survives, three times.

**And there is no `DELETE` keyword.** ClickHouse accepts `… DELETE WHERE …` and echoes it back
stripped, so a composer that emitted one would differ from `system.tables` on every read — and
the daily reconcile would re-apply the TTL every run, which on a years-deep table materialises
every part. This is the same failure the `toIntervalMonth` spelling avoids, found the same way,
against a live store rather than in a unit test.

---

## One ClickHouse for the deployment, and no `shard` column

The projection loop places **each tenant** on the node that holds its `activity_log`, rather than
walking nodes and projecting whatever is on each. That is the difference between a checkpoint per
tenant and a checkpoint per tenant *per node*, and only the first one survives a tenant moving:
`projection_checkpoint` is keyed by organization, so a tenant that lands on another node resumes
exactly where it was.

A `shard` column here would record where a row happened to be read from, which is a fact about
last Tuesday's topology and not about the tenant. Nothing would query it and the first rebalance
would make every existing value wrong. See [sharding](sharding.md).

## Adopting it, in the supported order

```bash
pnpm infra:up:analytics          # starts the container; nothing writes to it yet
```

1. **Set `CLICKHOUSE_URL`.** The container builds a projector, the worker registers
   `analytics-projection` (every five minutes) and `analytics-reconcile` (nightly), and the store
   starts filling. Nothing reads it.
2. **Watch `analytics.reconciliation.completed` come back clean for a few days**, and
   `analytics.projection.completed` report a `lagSeconds` that is not growing.
3. **Write the reader the dashboard needs**, against a store that has been filling and reconciling
   for days rather than one that started this morning.

**Not started by `pnpm infra:up`.** The pipeline exists, the container exists, and until step 1
nothing writes to it — a running analytics store with no consumer looks like a decision somebody
made.

> [!IMPORTANT]
> There is no read driver, and its absence is the guard. A flag that moved reads the moment the
> pipeline started would cut a dashboard over to a store that is still backfilling; a reader that
> does not exist cannot be flipped by accident.

---

## What is not wired, and is not meant to be

**The policy is wired, and since `23.14` so is one reader.** `projection_policy` decides which
actions reach this store and for how long. The screen edits it, the consumer honours it on both
sides of the reconciliation, and the nightly job converges the TTL to it. The reader answers one
question, activity over time, and nothing else. No rollup, no second store, no driver flag.

That ordering is deliberate rather than an accident of what got built first. The policy is the
part with a consequence that accumulates — an action excluded today is a gap that cannot be
filled from Postgres once the audit table's window passes — so it is the part worth having
before anyone reads a row. A read driver has no such deadline: it can be added the day someone
has a question.

Two rollup tables used to sit beside `activity_events` here and in Postgres, with the same columns
and the same grain, answering an `AnalyticsReader` port from both stores. Neither was ever written
to, in either store — the rollup job is move #2 in
[Data and scale](../../../../docs/opinions/data-and-scale.md) and was never built — and nothing ever
read them. Two empty tables, two adapters and a driver flag, all kept in step by hand to serve a
question nobody asked. They were deleted rather than filled.

What survives is the part that had a consumer, and the argument for the rest is in
[Simplicity](../../../../docs/opinions/simplicity.md): the store running and the seam existing are
two decisions, and a seam guessed at years early is not free just because it is cheap.

A materialized view computing those rollups inside ClickHouse would work and is the obvious
shortcut. It is also the exact move
[Data and scale](../../../../docs/opinions/data-and-scale.md) names as the way this store stops being
derived — a KPI computed there and stored nowhere else is authoritative, the rebuild story is gone,
and nobody decided it.
