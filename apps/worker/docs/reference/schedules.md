---
title: The schedules
description: Five repeatable entries, the fixed job ids that make registration idempotent, the clock order that keeps them off each other's locks, and why none of them retries.
---

# The schedules

| Schedule | When | Queue |
|---|---|---|
| `outbox-drain` | every second | `EVENT` |
| `partitions-monthly` | 02:00 on the first | `MAINTENANCE` |
| `cleanup-daily` | 03:00 daily | `MAINTENANCE` |
| `reconcile-daily` | 05:00 daily | `ANALYTICS` |
| `projection` | every five minutes | `ANALYTICS` |

## The clock order is not arbitrary

On the first of the month both monthly jobs run, in this order and for these reasons:

- **02:00 partitions.** A sweep that runs while the current month has no partition fails on a table
  it cannot write to, so the runway is extended before anything else touches `activity_log`. This
  is also the job that archives and drops what has aged out, which is why it goes first.
- **03:00 cleanup.** After the runway exists.
- **05:00 reconcile.** So on that one morning of the month it reads a window the retention pass has
  already finished with.

## A fixed job id is what makes registration idempotent

Every schedule registers on **every boot**. Without a fixed id, each deploy adds another repeatable
entry and the nightly job runs eleven times by Friday.

The `Queue` object exists only to publish the repeatable entry and is closed immediately: left open
it holds a second connection to the queue instance for the life of the process.

Schedules register **after** the consumers start, so a repeatable entry that fires the instant it
lands has somewhere to run. Registering a schedule onto a queue with no consumer is what left
`cleanup-daily` silently accumulating.

## None of them retries, and each for its own reason

**`partitions-monthly`: one attempt at the archive.** A retry would re-run `detach` on a partition
that is already detached and fail on *that* instead of on whatever actually broke, burying the real
error. A tenant-month that fails is logged and the loop continues, and nothing it touched was
dropped. See
[`infrastructure/docs/reference/cold-storage.md`](../../../../packages/infrastructure/docs/reference/cold-storage.md).

**`projection`: the schedule is the retry.** A failed run leaves the checkpoint where it was, and the
next tick five minutes later resumes from exactly the same place. A retry inside the job buys nothing
and stacks a second run on top of one that may still be holding a connection.

## Why five minutes, and not five seconds

The analytics queue is the one that is allowed to fall behind — nobody waits on a dashboard row — and
a five-minute cadence keeps each run a handful of large inserts rather than a stream of small parts
ClickHouse then has to merge.

`projection` and `reconcile-daily` register **only when the container holds an `AnalyticsProjector`**.
A schedule with no consumer accumulates silently; a schedule with a consumer but no store is worse,
because it looks like it is working.

## `partitions-monthly` has a real deadline

Migration `0000` created partitions through 2027-01. The day after the last one ends, **every insert
to `activity_log` fails** — which under the analytics design is also every analytics write.

**It covers every table on the allowlist, not `activity_log` by name.** `MaintenanceConsumer`
iterates `PartitionedTable.ALL` and calls `ensureMonthlyPartitions` once per entry, emitting one
`maintenance.partitions.ensured` line per table with the table as a *field*. So partitioning a new
table is one entry in that list and no edit here — and the deadline above applies to each of them
independently.

## `outbox-drain` is the only sub-minute schedule here

Every second, and that is the commit-to-delivery budget for anything riding the outbox. It is
deliberately a poll rather than a push: the cheap improvement later is Postgres `LISTEN`/`NOTIFY`,
and the trigger for reaching for it is written down as a measured commit-to-push budget under
500 ms. A shorter interval is not the answer — it multiplies empty queries without moving the
worst case.

It registers under a fixed `jobId` like every other schedule here, and at `priority: 1` so the
deliveries it creates cannot starve it.

## Retention archives, then drops — and one table is guarded

`partitions-monthly` ensures months ahead **and** retires months behind, per table. Retiring a
month is not a drop: the tenant-month is detached, streamed to S3, recorded in `partition_archive`
and verified, and only then dropped. `activity_log` at thirteen months, `notifications` at twelve,
`outbox_event` at two; `messages` is domain data and is never retired at all. There is no separate
archive job, because there is no month left that is dropped without one.

`outbox_event` carries one guard: if the oldest *unpublished* row is older than the cutoff, the
prune does nothing. A stuck event is never archived out from under the drain, which is the
difference between retention and data loss.

`activity_log` is the one table that also reaches ClickHouse, so the pass asks the projector where
each tenant is before it stamps `partition_archive.projected_at`. A tenant the projection has not
caught up with keeps a null stamp and gets an `analytics.projection.gap` line. The month is
archived and dropped either way — a forgotten switch costs a known hole, never an unbounded table.
See [`cold-storage.md`](../../../../packages/infrastructure/docs/reference/cold-storage.md).

## A schedule fires once; the job it enqueues walks every node

None of these registrations grew a shard dimension, and none should. A repeatable entry per node
would be N entries to keep idempotent, N to deregister when a node is retired, and a fan-out that
disagrees with the cluster the moment they drift. The schedule stays one entry, and the consumer
loops — see [the consumers](consumers.md).

`partitions-monthly` is the one where that matters most: the deadline is physical. A node with no
partition for next month rejects inserts on the first, and `runOnce()` at boot recovers the runway
on **every** node because the job it enqueues does, not because the schedule knows how many there
are.

**The boot job keeps no failure** (`CR.17`). It has a fixed id, `partitions-boot`, so two replicas
booting together enqueue one job. BullMQ ignores an `add` whose id is still in the failed set, and
the job kept its last hundred failures — so one boot with Postgres down disabled the recovery at
every later boot, silently. It is `removeOnFail: true` now: the failure is still a
`queue.job.failed` line, and the next boot enqueues again.

