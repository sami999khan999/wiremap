---
title: The schedules
description: Seven repeatable entries and one boot job, the fixed job ids that make registration idempotent, the clock order that keeps them off each other's locks, and why only one of them retries.
---

# The schedules

| Schedule | When | Queue |
|---|---|---|
| `outbox-drain` | every second | `EVENT` |
| `partitions-monthly` | 02:00 on the first | `MAINTENANCE` |
| `cleanup-daily` | 03:00 daily | `MAINTENANCE` |
| `retention-daily` | 03:30 daily | `MAINTENANCE` |
| `orphans-daily` | 04:00 daily | `MAINTENANCE` |
| `digest-daily` | 07:00 daily | `NOTIFICATION` |
| `spares-topup` | every five minutes | `MAINTENANCE` |

`partitions-boot` is not a repeatable entry: `runOnce()` adds it once at every boot, before the
schedules register. See the last section.

## The clock order is not arbitrary

On the first of the month the maintenance jobs run in this order, and for these reasons:

- **02:00 partitions.** A sweep that runs while the current month has no partition fails on a table
  it cannot write to, so the runway is extended before anything else touches `activity_log`.
- **03:00 cleanup.** After the runway exists.
- **03:30 retention, 04:00 orphans.** Neither runs DDL on a partition, so each wants only to be
  somewhere the other passes are not.

## A fixed job id is what makes registration idempotent

Every schedule registers on **every boot**. Without a fixed id, each deploy adds another repeatable
entry and the nightly job runs eleven times by Friday.

The `Queue` object exists only to publish the repeatable entry and is closed immediately: left open
it holds a second connection to the queue instance for the life of the process.

Schedules register **after** the consumers start, so a repeatable entry that fires the instant it
lands has somewhere to run. Registering a schedule onto a queue with no consumer is what left
`cleanup-daily` silently accumulating.

## Only the digest retries

The maintenance entries set no `attempts`, so each runs once. **The schedule is the retry**: every
one of them is idempotent, and the next tick does the same work again. A retry inside the job would
stack a second run of table-level DDL on top of one that may still be holding its locks.

`digest-daily` is the exception, with five attempts backing off from a minute. It is one job a day,
and one failed fan-out at 07:00 would otherwise be every tenant's digest, gone.

## `partitions-monthly` has a real deadline

The baseline migration creates the parent tables and no months. Each tenant's months are made by
this job, and by the spare-tenant seeding before a tenant is handed out. **The day a tenant's last
month ends, every insert to its `activity_log` fails.**

**It covers every table on the allowlist, not `activity_log` by name.** `MaintenanceConsumer`
iterates `PartitionedTable.MONTH_PARTITIONED` and ensures the runway once per entry, emitting one
`maintenance.partitions.ensured` line per table and tenant with both as *fields*. So partitioning a
new table is one entry in that list and no edit here — and the deadline above applies to each of
them independently.

## `outbox-drain` is the only sub-minute schedule here

Every second, and that is the commit-to-delivery budget for anything riding the outbox. It is
deliberately a poll rather than a push: the cheap improvement later is Postgres `LISTEN`/`NOTIFY`,
and the trigger for reaching for it is written down as a measured commit-to-push budget under
500 ms. A shorter interval is not the answer — it multiplies empty queries without moving the
worst case.

It registers under a fixed `jobId` like every other schedule here, and at `priority: 1` so the
deliveries it creates cannot starve it.

## Nothing here drops a month

`partitions-monthly` only ensures months ahead. Lite has no pass that retires months behind, so
every partitioned table grows until you port one — see
[`docs/scale/retention.md`](../../../../docs/scale/retention.md). The nightly `retention-daily` job
touches the bucket, not the partitions: it converges the `export/` lifecycle rule and sweeps the
`cold/` archives of tenants deleted more than thirty days ago. See
[the consumers](consumers.md).

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

