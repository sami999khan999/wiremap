---
title: How data flows
description: One request followed from arrival to years later — which store it touches, in what order, and why each store exists. The narrative companion to the data ownership rules.
---

# How data flows

> Orientation, not a rule. [`docs/opinions/data-and-scale.md`](opinions/data-and-scale.md) decides
> which store owns which data and states the positions. This page walks one request through them in
> order, for a reader building a mental model of the system rather than settling an argument.

Start with the one rule that explains every choice below.

**Postgres owns anything a transaction depends on, or that a user reads back immediately after
writing. Everything else is a copy.** And the test for whether you got it right: if deleting a store
loses something you cannot rebuild from Postgres or S3, then it quietly became a source of truth,
whether anyone decided that or not.

Now follow one request. Someone clicks "invite a teammate".

## While the user waits

**Who are you.** The request arrives with a session cookie. The server needs to know not just who
you are but what you may do. It asks Redis first, where your permissions are cached for a minute.
On a miss it asks Postgres, builds the answer, and puts it back in Redis. Permissions are safe to
cache because they can always be rebuilt.

**May you do this.** Every procedure is mapped to a permission, and a procedure with no mapping is
refused rather than allowed. Then the real check runs inside the business logic, not at the edge,
because the worker and server-rendered pages skip the edge entirely.

**The write, all at once.** One Postgres transaction opens, and three things go in together.

- **The invitation itself.** This is the fact the product cares about.
- **An audit row.** Someone invited someone, at this time. It shares the transaction on purpose. If
  the invite happened, the audit says so, and there is no window where one exists without the other.
- **An outbox row.** This is a message for the rest of the system, written to a Postgres table
  rather than sent to a queue. If it went to a queue and the transaction then failed, an email would
  go out about something that never happened. Postgres cannot half-commit, so the message and the
  fact live or die together.

The transaction commits, the response goes back, and the user sees a confirmation. **That is the
entire synchronous path.** Everything else happens after they have stopped looking.

Meanwhile log lines went to standard output and on to the log store. Those are allowed to be lost.
They describe how the system behaved, not what happened to the business.

## After the response

**About a second later** the worker sweeps the outbox, finds the unpublished row, and hands it to
whatever subscribed. A subscriber decides an email is due and puts a job on Redis. This is a
different Redis instance from the permission cache, and the separation is the point. Losing a cached
permission costs a rebuild. Losing a queued email costs an email.

**About five minutes later** the audit rows get copied into ClickHouse, which is a database built
for counting millions of rows quickly. It asks ClickHouse itself where it left off rather than
keeping a bookmark somewhere else, because a bookmark can disagree with reality and this cannot.
ClickHouse is purely a copy. Delete the whole thing and it can be rebuilt by replaying.

**Overnight** two jobs run. One deletes expired sessions, tokens and invitations. The other counts
yesterday's audit rows on both sides and compares them. Silence means the copy is honest.

## Over months and years

**On the first of each month** the partition job runs. It creates next month's partitions ahead of
time, then handles the old ones.

It never simply deletes. It detaches the old month, streams it out to S3 as one compressed file per
tenant, checks that what landed matches what left, records where it went, and only then drops it.
Data moves somewhere cheaper. It does not get destroyed.

After that the file sits in S3 until its own expiry, and the copy in ClickHouse sits there until
its own, which is much longer than Postgres keeps anything. If someone needs an archived month back,
an administrator can restore it.

```
request ──▶ Redis cache ──▶ Postgres  ── one transaction ──▶ response
                              │  the fact, the audit row, the message
                              │
                   ┌──────────┴──────────┐
              Redis queue           ClickHouse          the copies
                   │                                    for jobs and
                 email                                  for counting
                              │
                          after months
                              │
                             S3         compressed, per tenant
```

## The timing, in one place

| When | What happens |
|---|---|
| Immediately | Permissions cached for 60 seconds |
| Every second | Outbox drained, jobs queued |
| Every 5 minutes | Audit rows copied to ClickHouse |
| Nightly | Expired rows swept, the two copies compared |
| Monthly | New partitions created, old ones archived then dropped |
| About 13 months | A month leaves Postgres for S3 |
| 5 years | The ClickHouse copy expires |

## Why a table is really many tables

Three tables are split by month, so one name is a parent and the rows live in monthly children
underneath it. The application never names a child. It writes to the parent, and Postgres routes
the row by its date column.

This buys two things. A query narrowed to a date range skips the months it cannot match. And
deleting a month is one instant catalog edit rather than a row-by-row delete that leaves the table
the same size afterwards.

It costs one thing. Children do not create themselves, so next month's must exist before its first
row arrives. The monthly job keeps two spare months ahead, which is why a worker can miss a run
without anything breaking.

## The shape to remember

One store holds the truth and answers questions about right now. Everything else is either a copy
made for speed, a queue made for work, or a cheap shelf for things too old to keep close. The
copies can all be rebuilt, and that is what makes them safe to lose.

## Where each piece lives

| Piece | File |
|---|---|
| The permission check every use-case runs | `packages/application/src/primitive/authorizer.ts` |
| Which tables are split by month, and for how long | `packages/application/src/primitive/partitioned-table.ts` |
| The outbox sweep and the email path | `apps/worker/src/consumer/outbox.consumer.ts` |
| The copy into ClickHouse and the nightly comparison | `apps/worker/src/consumer/analytics.consumer.ts` |
| Partition creation, expiry sweeps, and the archive | `apps/worker/src/consumer/maintenance.consumer.ts` |
| Writing a month out to S3 | `packages/infrastructure/src/pg/repository/pg-partition-archive.gateway.ts` |
| The ClickHouse table and its expiry | `packages/infrastructure/clickhouse-migrations/0000_activity_events.sql` |

The positions behind all of this are in [`docs/opinions/data-and-scale.md`](opinions/data-and-scale.md).
What is planned and not yet built is in [`docs/plans/BACKLOG.md`](plans/BACKLOG.md). The
messaging, email and notification features are its §11, built on the communication performance
plan that makes them one system rather than eight features.
