---
title: Fan-out
description: The three patterns that fail before the database does, measured against the running stack — what one change for twenty-five thousand people actually costs, and which of the three is the one to worry about.
---

# Fan-out

[Data and scale](../../../../docs/opinions/data-and-scale.md) §6 names three application patterns
that fail at every scale on its own page, and says no store choice fixes any of them. This is the
measurement.

```bash
pnpm infra:up
FAN_OUT_SCALE=1000,10000,25000 pnpm smoke
```

Absent, the suite skips — it writes a `users` row per recipient, and those rows are **reused rather
than deleted**, for a reason that turned out to be the fourth finding below.

## What it measures

One tenant, `N` members, and the three paths one change triggers:

| Path | What it is | What is measured |
|---|---|---|
| Notification write amplification | one change, one row per recipient | `PgNotificationRepository.saveMany`, then the same records again |
| Digest fan-out | the nightly scan, keyset pages of 200 | `PgNotificationRecipientReader.organizationMembers` to exhaustion |
| Realtime fan-out | one frame per member, on that member's own channel | `RedisRealtimePublisher.publish`, `N` times |

Each is measured on its own, so a slow reading names one of the three rather than "the fan-out". Statement counts come from drizzle's logger, which counts what was actually issued.

## The readings

Measured 2026-09-20 in the big kit, against the compose stack on one developer machine — Postgres and Redis in
Docker on the same host, a database holding 82 tenants. **Orders of magnitude, not promises**: the
shape of each column is the point, not its absolute value, and consecutive runs move the
millisecond columns by about a tenth while the statement and page counts do not move at all.

| Recipients | Write | Statements | Replay | Digest | Pages | Publish, serial | Publish, chunked |
|---|---|---|---|---|---|---|---|
| 1 000 | 209 ms | 1 | 146 ms | 18 ms | 6 | 806 ms | **42 ms** |
| 10 000 | 1 826 ms | 10 | 1 123 ms | 144 ms | 51 | 8 053 ms | **289 ms** |
| 25 000 | 5 026 ms | 25 | 2 825 ms | 696 ms | 126 | 17 944 ms | **769 ms** |

The last two columns are the same `N` frames through the same publisher, once as a `await` per
frame and once as `Promise.all` over chunks of 500.

## What they say

**The notification write is not the problem it looks like.** Twenty-five thousand rows in
twenty-five statements and 5.0 seconds — about 0.2 ms a row, and flat as the tenant grows. The
chunking in `PgNotificationRepository` is what makes that true, and the spec asserts the statement
count rather than the time, because that is the property that can silently stop holding. §6's
warning about this path is about the **table**, not the write: five rows per change is five times
the row count, which is what the partitioning answers — and, in the big kit, the retention policy
([Retention](../../../../docs/scale/retention.md)).

**The replay is half the cost of the write, and it writes nothing.** Delivery is at-least-once, so
a redelivered event is the normal case rather than the exceptional one, and `ON CONFLICT DO NOTHING`
against the dedupe index still costs a statement per chunk and 2.8 seconds at 25 000. Budget for
the path running twice, because it will.

**Digest fan-out is cheap, and the page count is the whole cost.** One query per page of 200 —
126 queries for 25 000 recipients, and between 0.14 and 0.7 seconds depending on what else the
database is doing — tens of microseconds a recipient either way. §6's fix for this path
is to group recipients by capability shape, and the reason it is not needed yet is the one
`SendNotificationDigestUseCase` gives: the digest reads a recipient's own rows, so it resolves no
capability per person. These numbers are what that claim looks like when it is true.

**Realtime fan-out was the one to worry about, and the fix was four lines.** Eighteen seconds for
one frame to each of 25 000 members, dead linear at ~0.8 ms a publish — one serialised round trip each.
Nothing about that number is Postgres, and no store choice changes it. Issuing the same frames in
chunks of 500 through the same publisher takes **769 ms**: ioredis multiplexes one socket, so a
chunk leaves as one write instead of 500 round trips. **Twenty-three times faster**, at 31 µs a
frame.

**The loop is chunked now.** `DeliverNotificationUseCase` notifies 100 recipients at a time — its
audience is already capped at 500, so that is usually one chunk. Bounded rather than `Promise.all`
over the whole list: a tenant of a hundred thousand is not a write buffer to build.

The table above measures the chunked shape directly. The use-case sends the same frames through the
same publisher, so its saving is this one extrapolated rather than separately measured — worth
saying, because a number nobody took is a number somebody will quote.

A further shape, not needed yet: **Redis Streams behind `RealtimeSubscriber`**, where a member reads
from `last-event-id` rather than being written to.

## The fourth finding, which came from the teardown

**Deleting a `users` row costs a scan per tenant partition of any partitioned table with a foreign
key to `users`.** The cascade is a referential-integrity trigger on `users`, and it issues a
`DELETE … WHERE user_id = $1` with no partition key in the predicate — so the planner touches every
partition of that table whether or not a row is there.

In the big kit that table was `conversation_members`, and at 82 tenants deleting three hundred
synthetic users exceeded a thirty-second `statement_timeout`. **Lite has no partitioned table with a
key to `users`**, so the cost does not apply today. A new one would bring it back, and at a few
thousand tenants on a node a user delete would have to become a maintenance job.

The fixture still gives its people **deterministic ids and never deletes them**: the leak is bounded
by the largest scale ever run, and a run killed half way through leaves nothing unfindable.
