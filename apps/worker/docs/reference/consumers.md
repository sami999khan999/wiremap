---
title: The consumers
description: Six consumers, all serial, all with a public handle() — the batch sizes and why they are what they are, and the failure each one exists to make visible.
---

# The consumers

| Consumer | Queue | Jobs | Registered |
|---|---|---|---|
| `MaintenanceConsumer` | `MAINTENANCE` | cleanup · partitions | always |
| `EmbeddingConsumer` | `EMBEDDING` | index | always |
| `MailConsumer` | `MAIL` | send | always |
| `OutboxConsumer` | `EVENT` | drain · deliver | always |
| `NotificationConsumer` | `NOTIFICATION` | digest-fanout · digest | always |
| `AnalyticsConsumer` | `ANALYTICS` | project · reconcile | only with a ClickHouse config |

## `handle()` is public on every one of them

This — not `start()` — is the consumer's unit of work. `start()` is the BullMQ binding around it and
needs a live Redis, so **a private handler is a handler no test can reach.**

## Every consumer is serial

`MaintenanceConsumer` takes table-level locks and runs nightly; two overlapping runs buy nothing and
can deadlock on the same partition.

`AnalyticsConsumer` is serial **regardless of what is configured elsewhere**, and this one is not a
dial worth turning: two overlapping runs read the same checkpoint, project the same rows, and turn
one batch into two. Correctness here rests on there being exactly one writer — not on the insert
being idempotent, though it is that too.

## `MaintenanceConsumer` exists because a schedule had no consumer

`CleanupSchedule` published onto `MAINTENANCE` and nothing was listening, so the jobs accumulated
silently. That is why this file was written before the rest.

An unknown job name **throws** rather than succeeding quietly: a schedule renamed on one side and not
the other should be loud.

| Constant | Value | Why |
|---|---|---|
| months of partition runway | 3 | A partitioned table with no partition for the current date rejects **every** insert. At one month, a single missed run is a total write outage at midnight on the first; at three, the job can fail twice before anything breaks |
| `activity_log` retention | 13 months | Keeps a full year queryable in Postgres and retires the month that has just fallen out of it. On the allowlist, like every other table's — there is no constant here any more |

**There is no `archive` job.** `partitions` ensures the runway and then retires what has aged out,
and retiring is archive-then-drop: a month leaves only behind a verified object in cold storage.
The cutoff is computed **from the clock** and the months from `PartitionedTable.byName(table)
.retentionMonths`, so a redelivered job retires the same months rather than ones relative to
whenever the retry happened, and adding a partitioned table is one allowlist line.

The archive loop is per table-month across every tenant, and it logs one line per table-month:
a month with five thousand tenants must not be five thousand lines. A tenant whose upload fails is
logged and skipped, and nothing of that tenant's was dropped. See
[`cold-storage.md`](../../../../packages/infrastructure/docs/reference/cold-storage.md).

**`MONTHS_PER_RUN` counts partitions, not runway, and the two differ by one.** Three is the current
month and the next two, so the job survives two consecutive missed runs and the third is a write
outage. The constant used to be called `MONTHS_AHEAD`, which read as three months of runway and was
never that — the log field is `months` for the same reason.

**The sweep takes expired invitations as well as sessions and verifications**, and that one is not
housekeeping: `invitations_email_uq` is on `(organization_id, email)`, so a lapsed row keeps that
address un-invitable until something removes it. Nobody would connect "re-invite says the address
already has an invitation" to a row that expired last month.

**The `retention` job converges four things, and only the fourth destroys anything it was not
already told to.** The bucket's lifecycle rules, the ClickHouse TTL and the expired
`partition_archive` rows all follow from a policy row. `sweepDeletedTenants` does not: it deletes
the objects of tenants whose `organizations` row is gone and whose archive is older than
`DELETED_TENANT_DAYS`, which is the thirty-day recovery window `DeleteOrganizationUseCase`
deliberately leaves open. It emits `cold.objects.swept` with `reason: "tenant_deleted"` only when
it removed something — a nightly line saying "swept nothing" is a line nobody reads, which is how
the one that matters gets missed.

## `EmbeddingConsumer` catches nothing, on purpose

```ts
// Let it throw.
```

BullMQ's retry and backoff are driven by rejection, so catching and logging inside the handler turns
a retryable failure into **permanent, silent data loss**.

Failures are observed from the `failed` **event** instead, never from a `catch` inside the handler:
the listener does not swallow, so BullMQ still sees the rejection and still retries.

Everything worth testing lives in `IndexDocumentUseCase`.

## `AnalyticsConsumer`: two jobs, one failure

Both jobs exist because of the same failure, and it is **not** an outage: it is a projection that
stopped quietly on a Tuesday and was noticed a quarter later when a report looked wrong. `project`
moves the rows; `reconcile` is what notices when it has not been.

It is registered only when the container was built with a ClickHouse config — a consumer polling a
store that is not running looks identical to a working one.

### `project`

Read the checkpoint **out of the destination**, walk forward in keyset batches, stop when a batch
comes back short. The checkpoint advances because rows landed, never because a batch was
acknowledged, so a projector that failed mid-insert resumes from what is actually in the table. See
[`infrastructure/docs/reference/clickhouse.md`](../../../../packages/infrastructure/docs/reference/clickhouse.md).

| Constant | Why |
|---|---|
| batch size | Large enough that ClickHouse merges a small number of big parts. A thousand single-row inserts create a thousand parts and the background merge never catches up |
| max batches per run | A ceiling on one job, not on the backlog. Without it the first run after a long outage holds a Postgres connection for a full replay; with it the job stops, the schedule fires again in five minutes, and the checkpoint resumes exactly where it ended |
| lag threshold | Two runs of the schedule. One late run is a slow batch; two is a consumer that has stopped |

A short batch means the replay has caught up — continuing would issue one more query to learn what
the length already said.

**A run starts where the last one stopped, and wraps round** (`CR.20`). The budget is shared across
tenants, and when every run started at the first tenant in id order, one tenant with a large backlog
early in that order spent it every time and nobody after it was reached — unmeasured, because the
lag line is the maximum and that tenant was the maximum. The cursor is the last tenant a run reached,
kept in the cache for a day: losing it costs one run that starts at the beginning again. Once the
budget is spent the walk stops paging the catalog too, so `tenants` on the completion line counts the
tenants the run *reached*.

**One tenant's failure does not stop the others.** It emits `analytics.projection.failed` and the walk
moves on; the run still throws the first error once everyone else has had a turn, so BullMQ counts it
failed. **Three failures in a row do stop it**, because that is the store and not the tenants: a dev
stack with `CLICKHOUSE_URL` set and ClickHouse not running wrote a failure line for every tenant every
five minutes, 180 of them in one sitting, until this rule. The cursor still advances past the three. The directory lookup and the checkpoint read that follow a failure are both guarded
(`CR.44`): either one throwing used to replace the error it followed, and the failure line was never
emitted. A checkpoint that could not be read reports `eventId: "unknown"`, not `"none"`.

**The walk stops thirty seconds behind the clock, and that bound is not tuning.** `occurred_at` is
stamped when a transaction *starts*, and transactions commit in whatever order they finish. A slow
write that stamped an early timestamp becomes visible after a fast one that stamped a later one, so
without a horizon the checkpoint moves past a row that has not been written yet — and the keyset is
strictly greater, so that row is never read again. The projection is rebuildable and the loss would
still be silent: ClickHouse would simply be missing rows nobody counted. Thirty seconds is longer
than any transaction this system runs, and the cost is that analytics trail the audit trail by half
a minute. The same horizon goes to the lag query, or the metric reports a backlog the walk was never
going to reach.

**Lag is warned on separately, at `warn` rather than `debug`.** A projection that throws is already an
error line; one that quietly falls further behind every run produces nothing at all.

**Lag is the age of the oldest row still unprojected — not the age of the newest projected one.**
Those differ in exactly the case the metric exists for. The second measures how recently anything
happened, so a caught-up deployment that has been quiet for ninety minutes reports ninety minutes of
lag and trips the threshold every run; and a run that stopped at its batch ceiling reports the age of
the last row it *did* write, which understates a backlog rather than overstating it. Both readings
are wrong in the direction that costs the most: a false alarm nobody can act on, and a real backlog
that looks smaller than it is.

Caught up means zero, and the run already knows it is caught up — a short or empty batch is what
stopped the loop. Only a capped run pays for the answer, with one keyset query for the next row after
the checkpoint, which is the run where knowing the true backlog age is worth a query.

**Both jobs read `projection_policy` once per run.** Once, not per tenant: it is one small table
and every tenant's walk subtracts the same list. The list also goes to the lag query — lag measured
over rows that will never be projected is a backlog that never shrinks and an alert that never
clears.

**And both return immediately when `platform_policy.projection_enabled` is false.** No batches, no
lag computation, no drift comparison, and **no log line** — 288 lines a day saying "paused" is
noise the one line that matters would be lost in. The `retention` job's `applyRetention` still
runs: the connection exists, and a TTL edit is not a projection.

**A tenant with no directory row is skipped, not fatal — `23.21`, decided 2026-09-25.** A tenant
in `organizations` with no `shard_assignments` row cannot be placed. It used to fail the whole
run, so one stray row stopped analytics for every tenant. Now both jobs skip it and emit
`analytics.tenant.skipped` at `error`, naming the tenant and the job. The completed line counts
it in `skipped`. The skip is decided by asking the directory *after* the throw. Only a missing
row skips. A catalog that cannot be asked still fails the run and retries, because a catalog
outage that skipped every tenant would look like a quiet, successful run.

### `reconcile`

Counts per day on both sides and a diff. **Neither store reaches into the other** — each answers the
same question in the same shape and this compares the answers, which is what keeps both adapters
single-store.

Today is excluded: it is still being written to, so a difference in it is timing rather than drift,
and a check that cries wolf daily is a check nobody reads.

Drift is logged **one line per drifting day**, not one line listing them — a log field is something
you filter and alert on, and the day is exactly the grain an operator groups by when deciding how far
back to replay.

It logs at `error`, not `warn`: every number a dashboard has shown since the first drifting day is
wrong, and the fix is a replay — which only works while the activity log still covers the window, so
the alert has a deadline attached.

**`reconciliation.completed` is emitted whether or not anything drifted, and carries the count.** It
used to return early on drift, which made two very different situations the same absence: a
reconciliation that is running and finding drift, and a consumer that has stopped running at all.
The one signal an operator needs from this job is "it ran"; making that signal conditional on the
answer being clean is the same mistake as not having the job.

The `projection` label rides every line this consumer emits. There is one projection today; the field
exists so a second one does not change the event shape, and so a dashboard filters on it rather than
on the queue name.

### `cold-reproject`

One archived month read back out of S3 and into the derived store. It lives on this consumer and
not on `MaintenanceConsumer` for one reason: **this consumer owns the projector**.

Per object: read it through `ColdArchiveReader` (verified against the recorded checksum and
count), map each line with the same `ActivitySubject.of` the live replay uses, **drop the excluded
actions** — a re-projection that ignored the policy would put back exactly the rows it says not to
carry — insert in batches, then stamp `projected_at`. The stamp is last: a stamp on a projection
that failed is a gap the partial index can no longer find.

Idempotent through the `ReplacingMergeTree`, so a second run over the same month is the same rows
keyed the same way rather than a doubling. That is what lets the screen offer the button without
a confirmation.

## `MailConsumer` is the only thing in this system that sends

Every message — Better Auth's four, and the invitation — is published as a job rather than sent
inline. That buys retries, exponential backoff and duplicate suppression by job id from BullMQ, and
it costs one thing worth saying out loud: **in development, mail only arrives while the worker is
running.** A stopped worker is a sign-up whose verification link is queued and never rendered.

**The rate limiter is a worker option, never a use-case concern.** A provider's cap is a property
of this queue and of nothing else, so `{ limiter: { max: Env.mailRatePerMinute, duration: 60_000 } }`
here is what keeps it out of every caller as a sleep.

**`mail.delivery.failed` is emitted from the `failed` listener, and only on the last attempt.**
`attemptsMade` counts the one that just failed, so equality with `opts.attempts` is the final try.
With no delivery table, that line and `mail.delivery.sent` are the whole record of what happened to
a message — which is exactly why the sent line carries the transport's message id, the thing a
provider webhook would later correlate against.

## `OutboxConsumer` runs two different jobs, and the split is the design

`drain` reads a batch of unpublished events and turns each into one `deliver` job **per
subscriber that listens for it**. `deliver` parses the envelope and calls that one subscriber.

**One job per (subscriber, event) is what makes a failure local.** A single job calling every
subscriber in turn would retry all of them because one was down, and an idempotent subscriber
would still do its work again on every retry.

**The job id is `<subscriber>_<eventId>`, and it is the deduplication key.** A crash between
`relay` and the `published_at` mark re-drains the same rows, produces the same ids, and BullMQ
drops the duplicates — which is why `removeOnCompleteAgeSeconds` on this queue asks for 24 hours
rather than the default hour.

**The window is the last thousand deliveries or 24 hours, whichever is shorter.** BullMQ trims a
queue's completed set on every completion, by whichever of age and count bites first. It used to be
seconds: the drain's own repeat job, on this same queue once a second, set `removeOnComplete: 10`,
which trimmed the *shared* set to ten. It sets `true` now, which removes only itself. **Nothing
depends on the window even so**: the subscribers are idempotent on `event.id`, which is a stated
requirement rather than a hope, and the id dedupe is a cheap first line rather than the guarantee.

**A delivery gets twelve attempts, doubling from five seconds — about three hours.** Its outbox row
is already marked published, so a delivery that runs out is recoverable only by replay: it stays in
the failed set for a week (`pnpm queue:replay event deliver`). Every other job defaults to eight,
about ten minutes. Three from two seconds, the old default, gave up inside a Postgres failover.

**A pass over every node goes on past a node that fails.** `Container.eachShard` catches each
node's error, logs `shard.sweep.failed { node }`, runs the rest, and rethrows the first at the end so
the job still fails and still retries. Before, node 2 down meant node 3's outbox was never drained.

**An event nobody listens for still gets marked published.** Leaving it pending would make the
outbox grow forever on a name whose subscriber was deleted.

**The drain is bounded**: 100 rows a batch, at most 20 batches a run. Unbounded, a backlog would
hold the worker inside one job while the one-second schedule piled up behind it. And it runs at
`priority: 1`, ahead of the deliveries it creates — a backlog of `deliver` jobs must not starve the
drain, or the outbox grows while the worker looks busy — and the deliveries carry
`priority: 10` for that to mean anything. A job with **no** priority goes on the plain wait list,
which `moveToActive` empties before it looks at the prioritized set, so a priority on the drain
alone put it exactly last.

`outbox.drain.lagged` exists because a drain that has stopped running is otherwise silent: "no
events published" and "no events to publish" produce the same line. Sixty seconds behind, on a
one-second schedule, means the drain is not running rather than that it is busy.

## `NotificationConsumer` fans out one job per tenant, and never sends

Two jobs on `QueueName.NOTIFICATION`, the same split `OutboxConsumer` makes and for the same
reason. `digest-fanout` asks every node which of its tenants has anyone to write to and publishes
one `digest` job each; `digest` is one tenant's digest. One job per tenant rather than one job
doing every tenant is what keeps a digest that fails for one organization from stopping the other
four thousand.

**It enqueues mail rather than sending it.** `SendNotificationDigestUseCase` ends at
`mail.publish(...)`, so the message becomes a job on `QueueName.MAIL` and `MailConsumer` remains
the only thing in this system that talks to SMTP.

**The job id is `digest_<organizationId>_<day>`, and it is the deduplication key.** A schedule
that fires twice, or a fan-out that is redelivered after a crash, produces the same ids and BullMQ
sends one morning's digest. The day comes from `container.clock` in UTC rather than from the job
payload, so a retry covers the day it was for and not the day it ran.

**The fan-out pages each node's tenants from the catalog**, five hundred at a time, inside
`container.eachShard`, and enqueues each page's digest jobs in one `addBulk`. It used to ask
`notifications` which tenants had anything unread — one `SELECT DISTINCT` over every tenant's
partitions, which locks two runway months per tenant and ran out of lock slots near 5 800 tenants.
A tenant with nothing unread now costs its digest job one pruned query and no mail. There is no cap.

**The digest itself is four queries and one enqueue per page of two hundred people**: the
candidates, their addresses, their stored modes, and every one's unread rows at once through a
window function. The window is the day before, half-open, so a row lands in one digest only. The
per-tenant `digest` job places itself with `withShard`.

## Every cross-tenant pass loops the cluster, and the loop is over nodes

Five passes in this worker read or write without a tenant in hand, and each one is now wrapped in
`container.eachShard`, which enters a **node-only** shard scope: `{ key: null, node }`. Inside it,
`BaseRepository` resolves a `local` table to that node's pool and a routed read to that node's
tenants, and `PgUnitOfWork` opens its transaction there. Outside it, both fall back to node 0 —
which is the only node an unsharded deployment has, so today the loop runs once and nothing
changes.

| Pass | What loops | What does not |
|---|---|---|
| `OutboxConsumer.drain` | the claim and the mark, per node | the fan-out: one Redis for the deployment |
| `OutboxConsumer.reportLag` | `oldestPendingAt`, per node | the line — one a run, from the **worst** node |
| `MaintenanceConsumer.partitions` | the runway and the prune, per node | `retentionPolicies`, read once for the run |
| `AnalyticsConsumer` project / reconcile | **per tenant**, not per node | the checkpoint: one ClickHouse, keyed by tenant |
| `NotificationConsumer.fanOut` | the catalog's tenants, per node, a page at a time | the queue, and the per-tenant `digest` job |

**The projection is the one that loops tenants rather than nodes**, and that is not an
inconsistency. The other four are physical — a partition, an outbox row and a `SKIP LOCKED` claim
all belong to one database. A projection is one tenant's activity going to one ClickHouse, so it
places each tenant through the resolver and needs no per-node checkpoint and no `shard` column in
the analytics store. A tenant that moves resumes exactly where it was.

**The tenant page is narrowed by node, not filtered after the fact.**
`OrganizationReader.page(after, limit, onNode)` adds a correlated `EXISTS` over
`shard_assignments` — both catalog tables, so it stays one query. Without it, ensuring a runway
would read every tenant once per node and issue the DDL for tenants that are not there.

**`MaintenanceConsumer.cleanup` deliberately does not loop.** `sessions`, `verifications` and
`invitations` are catalog tables; sweeping them once per node would sweep the catalog N times.

**`PgPartitionArchiveGateway` is the one class that spans two placements on purpose.** It detaches
a partition on whichever node the sweep is walking and records what it did in `partition_archive`,
which is catalog — one index, read before any shard is known. Those statements go through
`BaseRepository.catalogDb`, which throws for any placement but `local` and never uses the open
transaction's client. The object key is unchanged by sharding: a tenant lives on one node, so
`cold/<table>/<yyyy>/<mm>/<organization_id>.ndjson.gz` is already unique, and a shard index in the
key or the row would name the shard the tenant *had* the day it moves.

