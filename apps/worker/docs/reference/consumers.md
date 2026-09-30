---
title: The consumers
description: Five consumers, all with a public handle() — the batch sizes and why they are what they are, and the failure each one exists to make visible.
---

# The consumers

| Consumer | Queue | Jobs | Registered |
|---|---|---|---|
| `MaintenanceConsumer` | `MAINTENANCE` | cleanup · partitions · retention · orphans · spares · tenant-export · tenant-delete | always |
| `EmbeddingConsumer` | `EMBEDDING` | index · reembed | always |
| `MailConsumer` | `MAIL` | send | always |
| `OutboxConsumer` | `EVENT` | drain · deliver | always |
| `NotificationConsumer` | `NOTIFICATION` | digest-fanout · digest | always |

## `handle()` is public on every one of them

This — not `start()` — is the consumer's unit of work. `start()` is the BullMQ binding around it and
needs a live Redis, so **a private handler is a handler no test can reach.**

## `MaintenanceConsumer` is serial

It takes table-level locks and runs nightly; two overlapping runs buy nothing and can deadlock on the
same partition. The other four take their concurrency from [`env.md`](./env.md).

## `MaintenanceConsumer` exists because a schedule had no consumer

`CleanupSchedule` published onto `MAINTENANCE` and nothing was listening, so the jobs accumulated
silently. That is why this file was written before the rest.

An unknown job name **throws** rather than succeeding quietly: a schedule renamed on one side and not
the other should be loud.

| Constant | Value | Why |
|---|---|---|
| months of partition runway | 3 | A partitioned table with no partition for the current date rejects **every** insert. At one month, a single missed run is a total write outage at midnight on the first; at three, the job can fail twice before anything breaks |
| spare tenants | 20 | Pre-seeded tenants kept on node 0, so a sign-up between two top-ups does not pay for DDL |
| deleted-tenant days | 30 | How long a deleted tenant's archive stays in `cold/`. The delete is recoverable for that long |

**`partitions` only ensures the runway. Nothing in lite drops a month.** It walks every
month-partitioned table on the allowlist, on every node, a page of that node's tenants at a time.
Moving old months out to cold storage is [`docs/scale/retention.md`](../../../../docs/scale/retention.md).

**`MONTHS_PER_RUN` counts partitions, not runway, and the two differ by one.** Three is the current
month and the next two, so the job survives two consecutive missed runs and the third is a write
outage. The constant used to be called `MONTHS_AHEAD`, which read as three months of runway and was
never that — the log field is `months` for the same reason.

**The sweep takes expired invitations as well as sessions and verifications**, and that one is not
housekeeping: `invitations_email_uq` is on `(organization_id, email)`, so a lapsed row keeps that
address un-invitable until something removes it. Nobody would connect "re-invite says the address
already has an invitation" to a row that expired last month.

**The `retention` job does two things, and only the second destroys anything.** It converges the
bucket's lifecycle to what `RetentionRules.lifecycleFor()` composes — one rule, `export/` expiring
after seven days — and logs `retention.lifecycle.drifted` before it repairs a bucket someone edited
by hand. Then `sweepDeletedTenants` deletes the `cold/` objects of tenants whose archive is older
than `DELETED_TENANT_DAYS`, which is the thirty-day recovery window a tenant delete deliberately
leaves open. See [`cold-storage.md`](../../../../packages/infrastructure/docs/reference/cold-storage.md). It emits `cold.objects.swept` with `reason: "tenant_deleted"` only when
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

Everything worth testing lives in `IndexDocumentUseCase` and, for `reembed`, `ReembedChunksUseCase`.
Both jobs are placed on the tenant's node with `withShard` first, because `document_chunks` is routed.

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
| `MaintenanceConsumer.partitions` | the runway, per node, over that node's tenants | the allowlist |
| `MaintenanceConsumer.orphans` | `orphanedTenants`, per node | the line — one per node that found any |
| `NotificationConsumer.fanOut` | the catalog's tenants, per node, a page at a time | the queue, and the per-tenant `digest` job |

All five are physical — a partition, an outbox row and a `SKIP LOCKED` claim all belong to one
database. The per-tenant jobs (`tenant-export`, `tenant-delete`, `digest`, the embedding jobs) do not
loop at all: each places itself on its tenant's node with `withShard`.

**The tenant page is narrowed by node, not filtered after the fact.**
`OrganizationReader.page(after, limit, onNode)` adds a correlated `EXISTS` over
`shard_assignments` — both catalog tables, so it stays one query. Without it, ensuring a runway
would read every tenant once per node and issue the DDL for tenants that are not there.

**`MaintenanceConsumer.cleanup` deliberately does not loop.** `sessions`, `verifications` and
`invitations` are catalog tables; sweeping them once per node would sweep the catalog N times.

**`PgPartitionArchiveGateway` is the one class that spans two placements on purpose.** It detaches
a deleted tenant's partitions on that tenant's node and records what it did in `partition_archive`,
which is catalog — one index, read before any shard is known. Those statements go through
`BaseRepository.catalogDb`, which throws for any placement but `local` and never uses the open
transaction's client. The object key is unchanged by sharding: a tenant lives on one node, so
`cold/<table>/<yyyy>/<mm>/<organization_id>.ndjson.gz` is already unique, and a shard index in the
key or the row would go stale the day the tenant is placed somewhere else.

