---
title: Fan-out
description: The three patterns that fail before the database does, measured against the running stack — what one message to twenty-five thousand people actually costs, and which of the three is the one to worry about.
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

One tenant, `N` members, and the three paths one message triggers:

| Path | What it is | What is measured |
|---|---|---|
| Notification write amplification | one change, one row per recipient | `PgNotificationRepository.saveMany`, then the same records again |
| Digest fan-out | the nightly scan, keyset pages of 200 | `PgNotificationRecipientReader.organizationMembers` to exhaustion |
| Message fan-out | one conversation frame, then one per member | `RedisRealtimePublisher.publish`, `N + 1` times |

Each is measured on its own, so a slow reading names one of the three rather than "the message
path". Statement counts come from drizzle's logger, which counts what was actually issued.

## The readings

Measured 2026-09-20 against the compose stack on one developer machine — Postgres and Redis in
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
the row count, which is what the partitioning and the retention policy answer.

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

**Message fan-out was the one to worry about, and the fix was four lines.** Eighteen seconds for
one message to 25 000 members, dead linear at ~0.8 ms a publish — one serialised round trip each.
Nothing about that number is Postgres, and no store choice changes it. Issuing the same frames in
chunks of 500 through the same publisher takes **769 ms**: ioredis multiplexes one socket, so a
chunk leaves as one write instead of 500 round trips. **Twenty-three times faster**, at 31 µs a
frame.

> [!IMPORTANT]
> One message to a conversation of 25 000 cost **~23 seconds** end to end, eighteen of them
> publishes. Chunked, it is **~5.8 seconds**, and the publishes are 0.8 of it. The remaining cost
> is the notification rows, which is where §6 said it would be.

**Both loops are chunked now.** `MessagingRealtimeSubscriber` publishes its member frames 500 at a
time, and `DeliverNotificationUseCase` notifies 100 recipients at a time — its audience is already
capped at 500, so that is usually one chunk. Bounded rather than `Promise.all` over the whole list:
a room of a hundred thousand is not a write buffer to build.

The table above measures the subscriber's shape. The use-case's is the same frames through the same
publisher, twice per recipient, so its saving is this one extrapolated rather than separately
measured — worth saying, because a number nobody took is a number somebody will quote.

Two further shapes, neither needed yet, in the order they cost least:

- **Do not fan out at all for the big rooms.** The body already rides the conversation channel and
  is published once; the per-user frames exist only to reorder a list. A room past some size can
  reorder on refocus instead — which is what the bell already does.
- **Redis Streams behind `RealtimeSubscriber`** (`26.5`), where a member reads from `last-event-id`
  rather than being written to.

## The fourth finding, which came from the teardown

**Deleting a `users` row costs a `conversation_members` scan per tenant partition on the node.**
The cascade is a referential-integrity trigger on `users`, and it issues
`DELETE FROM conversation_members WHERE user_id = $1` with no partition key in the predicate — so
the planner touches every partition of that table whether or not a row is there.

At 82 tenants on this machine that is enough to make deleting three hundred synthetic users exceed
a thirty-second `statement_timeout`. It is the same ceiling
[`sharding`](sharding.md) describes from the other side, and it is why the fixture here gives its
people **deterministic ids and never deletes them**: the leak is bounded by the largest scale ever
run, and clearing it is one slow statement somebody can choose to run.

A tenant delete is already a maintenance job. A *user* delete is not, and at a few thousand tenants
on a node it becomes one.
