---
title: How data flows
description: One request followed from arrival to months later — which store it touches, in what order, and why each store exists. The narrative companion to the data ownership rules.
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

Meanwhile log lines went to standard output. Lite keeps no log store, so they live as long as the
terminal or the platform's log buffer does. Those are allowed to be lost.
They describe how the system behaved, not what happened to the business.

## After the response

**About a second later** the worker sweeps the outbox, finds the unpublished row, and hands it to
whatever subscribed. A subscriber decides an email is due and puts a job on Redis. In lite this is
the same Redis instance as the permission cache, reached by a second name. Losing a cached
permission costs a rebuild. Losing a queued email costs an email. So the instance never evicts,
and every cache key carries an expiry instead. Splitting the two is an `.env` change
([Split Redis](scale/split-redis.md)).

**Overnight** two jobs run. One deletes expired sessions, tokens and invitations. The other keeps
the S3 bucket's expiry rules as they should be, and ends the recovery window of any tenant deleted
thirty days ago.

The big kit also copies audit rows into ClickHouse every five minutes, for counting. Lite does not.
[Analytics](scale/analytics.md) brings it back.

## Over months and years

**On the first of each month** the partition job runs. It creates the coming months' partitions
ahead of time. That is all it does. Lite never drops a month, so old rows stay in Postgres.

**When a tenant is deleted**, its rows are not simply thrown away. They are streamed out to S3 under
`cold/`, one compressed file per table and month, and checked against what left. Only then are the tenant's
partitions dropped. The files stay for thirty days, which is the window to change your mind. The
nightly job then removes them.

The big kit also archives each old month to S3 and drops it from Postgres. That comes back with
[Retention](scale/retention.md).

```
request ──▶ Redis cache ──▶ Postgres  ── one transaction ──▶ response
                              │  the fact, the audit row, the message
                              │
                         Redis queue          the copy for jobs
                              │
                            email
                              │
                     on tenant delete
                              │
                         S3 cold/       compressed, kept 30 days
```

## The timing, in one place

| When | What happens |
|---|---|
| Immediately | Permissions cached for 60 seconds |
| Every second | Outbox drained, jobs queued |
| Nightly | Expired rows swept, bucket expiry rules checked, deleted tenants past 30 days removed |
| Monthly | New partitions created; nothing dropped |
| 30 days after a tenant delete | Its archive in S3 is removed |

## Why a table is really many tables

Four tables are split by month, so one name is a parent and the rows live in monthly children
underneath it. The application never names a child. It writes to the parent, and Postgres routes
the row by its date column.

This buys two things. A query narrowed to a date range skips the months it cannot match. And
deleting a month, once retention is ported back, is one instant catalog edit rather than a row-by-row
delete that leaves the table the same size afterwards.

It costs one thing. Children do not create themselves, so next month's must exist before its first
row arrives. The monthly job keeps two spare months ahead, which is why a worker can miss a run
without anything breaking.

## The shape to remember

One store holds the truth and answers questions about right now. Everything else is either a copy
made for speed, a queue made for work, or a cheap shelf for a deleted tenant's data. The
copies can all be rebuilt, and that is what makes them safe to lose.

## Where each piece lives

| Piece | File |
|---|---|
| The permission check every use-case runs | `packages/application/src/primitive/authorizer.ts` |
| Which tables are split by month | `packages/application/src/primitive/partitioned-table.ts` |
| The outbox sweep and the email path | `apps/worker/src/consumer/outbox.consumer.ts` |
| Partition creation, expiry sweeps, and the tenant-delete sweep | `apps/worker/src/consumer/maintenance.consumer.ts` |
| Writing a tenant out to S3 | `packages/infrastructure/src/pg/repository/pg-partition-archive.gateway.ts` |
| The copy into ClickHouse, in the big kit | `upstream:apps/worker/src/consumer/analytics.consumer.ts` |

The positions behind all of this are in [`docs/opinions/data-and-scale.md`](opinions/data-and-scale.md).
What is planned and not yet built is in [`docs/plans/BACKLOG.md`](plans/BACKLOG.md). What lite
removed, and how to bring each piece back, is in [`docs/scale/`](scale/index.md).
