---
title: Partitions
description: Tenant first and month underneath, the allowlist as the whole policy, and pruning measured rather than assumed — what a partitioned table costs and what it buys.
---

# Partitions

**Every tenant-owned table is a tenant partition first.** Seven of them take
`PARTITION BY LIST ("organization_id")`, and the three that also grow with activity take
`PARTITION BY RANGE` again underneath, one child per month:

```
notifications                         ← the parent, LIST (organization_id)
└── notifications_<32hex>             ← one tenant,  RANGE (created_at)
    ├── notifications_<32hex>_2026_09
    └── notifications_<32hex>_2026_10
```

One table is deliberately month-only: `outbox_event`. The drain polls it once a second and must not
touch a partition per tenant to do it.

The month level is the test
[`docs/ai/rules/data.md`](../../../../docs/ai/rules/data.md) applies — a table that gains twelve rows
a year is not one of them, and partitioning it by month buys nothing for the cost of every mechanic
below. The tenant level is a different question: it is what makes a tenant's read prune to one
subtree, a tenant's data a `drop table`, and a physical split a data move rather than a rewrite.

## The allowlist is the policy

`PartitionedTable.ALL`, in `packages/application/src/primitive/partitioned-table.ts`, is a frozen
list of `{ name, tenantKey, column, retentionMonths }`. It is the whole policy for every partitioned
table, in one place:

| Table | `tenantKey` | `column` | `retentionMonths` |
| --- | --- | --- | --- |
| `activity_log` | `organization_id` | `occurred_at` | 13 |
| `outbox_event` | — | `occurred_at` | 2 |
| `notifications` | `organization_id` | `created_at` | 12 |
| `messages` | `organization_id` | `created_at` | `null` — domain data |
| `conversations` | `organization_id` | — | — |
| `conversation_members` | `organization_id` | — | — |
| `notification_preferences` | `organization_id` | — | — |
| `document_chunks` | `organization_id` | — | — |

`tenantKey: null` is "not split by tenant"; `column: null` is "tenant level only, never pruned by
the calendar"; `retentionMonths: null` is "never retired at all", which for `messages` means domain
data nothing drops. Every table that *is* retired goes through [cold storage](cold-storage.md)
first: detached, uploaded, verified, and only then dropped.

**Nothing reads a copy of this list.** `TenantPartitionSeed` walks the tenant-partitioned entries,
`MaintenanceConsumer.partitions()` walks the month-partitioned ones per tenant, and
`PartitionedTableName` — the closed union every gateway signature takes — is derived from the same
array. Adding a partitioned table is one entry, not one entry plus a record somewhere else that can
disagree with it. A fork sharding on a store or a region edits `TenantKey` and its schema, and
nothing else.

`check-architecture` §21 asserts the list against `migrations/*.sql` in both directions: a table
partitioned in a migration and missing from the allowlist gets no partition for a new tenant and the
notice is a failed insert on their first write, and an entry no migration partitions names a table
every `ATTACH PARTITION` will be rejected against.

## The parents are a migration; the children are a seed

A migration creates the partitioned **parents only**. Every child — each tenant's partition and the
runway months under it — is created by `TenantPartitionSeed`, which runs in the same transaction as
the `organizations` insert on every path that founds a tenant, and which `migrate.ts` runs for every
existing organization the moment a migration has been applied.

One implementation creates partitions. A SQL copy of it inside a migration would be a second one
that drifts from it the first time the shape changes.

**Created standalone, then attached** — never `create table … partition of`. That form takes an
`ACCESS EXCLUSIVE` lock on the parent for the rest of the transaction, which would stall every read
on all eight tables for the length of a signup. `ALTER TABLE … ATTACH PARTITION` takes
`SHARE UPDATE EXCLUSIVE`, which blocks nothing a request does, and an empty child attaches with no
validation scan — **as long as no foreign key points out of the parent into another partitioned
table.** One that does is validated on every attach and locks its target; see below.

Partition names are `<table>_<32hex>` and `<table>_<32hex>_<yyyy>_<mm>` — the tenant uuid with its
hyphens stripped, validated against `^[0-9a-f]{32}$` before it reaches `sql.raw`. The longest is
`notification_preferences_<32>` at 57 of Postgres's 63 characters.

## No foreign key points into a tenant-partitioned table

**`PF.1` dropped the last two**, `messages` and `conversation_members` into `conversations`, and
`tests/maintenance/tenant-partition.spec.ts` fails if one comes back. Each one cost three things,
all measured rather than reasoned (the ceiling table below has the numbers):

- **Every signup's attach validated it.** Attaching a partition to a table that carries a key
  checks that key, so the two referencing tables were the two slowest attaches in the seed.
- **That check took `SHARE ROW EXCLUSIVE` on `conversations`** — sampled from `pg_locks` during
  the run — which blocks every insert and update there. Five attaches per signup meant five
  windows in which nobody on the node could start a conversation.
- **A drop had to detach first.** Postgres will not drop a partition something references, and
  detaching is one `ALTER TABLE` per partition; dropping the ceiling run's 1 658 leftover tenants
  spent 60 of its 142 seconds detaching `conversations` alone.

What they checked, the code already had: every insert into either table runs
`ConversationAccess.assertMember` first, and nothing deletes a conversation, so `NO ACTION` never
fired. The nightly `orphans` job counts conversation ids that a member or a message names and
`conversations` does not hold, as it has counted tenants since `24.1`.

## Dropping a tenant: one statement per table, and never `CASCADE`

`TenantPartitionSeed.drop` is the one implementation. `dropTenantPartitions` (a tenant delete) and
`PgTenantMoveGateway.dropOn` (the move's reclaim) both call it.

- **No transaction around it.** Each `drop table` commits on its own, so a parent's
  `ACCESS EXCLUSIVE` lasts one statement. In one transaction, a single reader on one table kept every
  other parent locked until it let go. The spec holds a reader open on one table and watches the
  rest drop.
- **Fifty names to a statement**, so the parent's lock is taken once per batch. One at a time, the
  test teardown dropped two tenants a minute at 11 700 partitions; batched, 11 611 partitions took
  1 m 42 s (`4f45294`).
- **One probe for every name**, a single `pg_class` read, rather than a `to_regclass` each. A tenant
  already gone is `[]`, so a retry after a partial drop finishes the job.
- **Never `CASCADE`.** It buys nothing, since dropping a tenant partition takes its month children
  with it. And if a key into a partitioned table ever returns, a cascade from one partition drops
  that key from the parent, for every tenant, with nothing but a `NOTICE` to say so.

The drop still walks the allowlist backwards, which costs nothing and keeps the order right if a
key between siblings is ever reintroduced on purpose.

## Two mechanics that are not optional

**Every partition key is in the primary key.** Postgres requires every unique constraint on a
partitioned table to carry every partition key, so a two-level table is keyed
`(id, organization_id, created_at)` and a tenant-only one `(id, organization_id)`. `Uuid.v7()` is
time-ordered, so the key still increases with the month and the composite costs nothing in index
locality.

That rule reaches the foreign keys too. `conversations` is keyed on the pair, so
`messages.conversation_id` and `conversation_members.conversation_id` are composite references on
`(conversation_id, organization_id)` — declared with drizzle's `foreignKey({ columns, foreignColumns })`,
which is the only form that can express them.

This propagates. `notifications_dedupe_uq` carries `created_at` for the same reason, and that is
sound **only** because the value written is the *event's* timestamp rather than the clock's — a
redelivered event computes the same value and collides with itself. A dedupe index carrying a
`defaultNow()` column would be a unique index that never fires.

**Drizzle cannot express `PARTITION BY`,** and its snapshots do not know the clause exists — which
is why §21 reads the migration text rather than the schema. Every partitioned table is declared as
an ordinary `pgTable` so the query builder types it, and the clause is written onto the generated
DDL afterwards.

## Adding a partitioned table is three steps

1. **The schema**, with a composite primary key: `primaryKey({ columns })` naming every partition
   key. Drizzle emits the composite form only when the schema declares it.
2. **One allowlist line** in `PartitionedTable.ALL`, listed ahead of any table that references it.
3. **`pnpm db:generate`.**

That last one is two halves — `drizzle-kit generate && tsx partition-ddl.ts`. The generator opens
only the migration the last `meta/_journal.json` entry names, which is the one just written and
never an applied one, because the migrator hashes each file's whole text. For every `CREATE TABLE`
whose table is on the allowlist and carries no clause yet, it appends
`PARTITION BY LIST ("<tenantKey>")`, or `RANGE ("<column>")` for a table with no tenant level. It
creates no children — those are the seed's — and running it twice rewrites nothing.

**It refuses twice rather than guessing.** A primary key that omits a partition key stops the run
with *"declare the composite primary key in the schema; the generator does not synthesize keys"* —
the fix is the schema, not the migration. And a table an earlier migration already created
unpartitioned stops it too: converting a live table is the copy-and-swap below, written by hand.
`0023` is exactly that case, which is why it is hand-written.

A refusal leaves the file `drizzle-kit` wrote already on disk. Fix the schema and regenerate; the
migration has not been applied, and the journal entry is rewritten with it.

**No `DEFAULT` partition, ever.** A default partition turns "the month nobody created" from a failed
insert into a row in the wrong place, and the next `ATTACH` of that month has to scan the default to
prove it holds nothing. §21 fails the build on one.

## The runway, and what bounds tenants per node

`MaintenanceConsumer.partitions()` runs monthly and ensures three partitions per table per tenant —
the current month and the next two — so two consecutive missed runs survive and the third is an
outage. It reads the runway *before* ensuring and emits `partition.runway.low` when fewer than two
months lie ahead; read after, it could never fire, because the run that just fixed the runway has
nothing to report.

**One read and one transaction per page of tenants** — `ensureMonthlyPartitionsFor`, since `PF.5`.
The loop pages 200 tenants from the catalog; for each page it takes the table's advisory lock, reads
every child of all 200 tenant partitions in one `pg_inherits` query, works out the missing months in
memory, and creates only those. The runway each tenant had comes off the same read, before anything
is created, so `partition.runway.low` still reports what the run found rather than what it left.

The lock is taken **before** the read, because read-then-create is two statements: two replicas
booting together would both read a month as absent and one would get `42P07`. Per tenant, the old
loop was eight statements per table and the lock taken each time — 48 000 statements at 2 000
tenants. The prune pass reads every tenant's months of a table in one query for the same reason.

## What a node carrying tenants actually costs

Measured by `tests/smoke/tenant-ceiling.smoke.spec.ts`, which creates synthetic tenants through
`TenantPartitionSeed`. **Postgres 17, 2026-09-24**, on a developer machine (Docker Desktop on
Windows) that was **not idle** — builds ran beside both runs — so read a number that moved by less
than twice with suspicion. Sixteen partitions per tenant then: seven at the tenant level, plus three
months under each of the three tables that carry a month level. `widget_preferences` has since made it
eight at the tenant level; it takes no month level.

**Before and after section 9's `PF.1`–`PF.5`**, same machine, same day:

| tenants | signup DDL | drop one tenant | runway pass | plan |
| --- | --- | --- | --- | --- |
| 100 | 378 → 111 ms | 706 → 43 ms | 3.2 s → 70 ms | 0.58 → 0.30 ms |
| 500 | 645 → 150 ms | 228 → 88 ms | 11.6 s → 0.27 s | 0.67 → 0.36 ms |
| 2 000 | 354 → 377 ms | 127 → 42 ms | 35.6 s → 1.6 s | 0.31 → 0.21 ms |

Signup DDL is one tenant's probe, create and attach, from `pg_stat_statements` over twenty signups.
The first run's 2 000 row was taken after the smoke's own migrate step had applied `0037`, so its
signup number is already without the keys. That is why it barely moves.

**What the keys cost, read within one run.** The honest comparison is between tables in the same
run, since the machine's load moved both:

| attach, mean ms, 500 tenants | with the keys | without |
| --- | --- | --- |
| `conversation_members` | **116.1** | 6.7 |
| `messages`, a month | **108.6** | 2.4 |
| `notifications`, no key either way | 9.6 | 6.4 |

`SHARE ROW EXCLUSIVE` on `conversations` was sampled 2 227 times during twenty signups with the keys
and **zero** times without them, at every tenant count.

**Planning time does not grow with the tenant count, and that is the whole point of the tenant
level.** 0.2–0.7 ms at every count in both runs. The predicate prunes to one list partition before
the planner considers a month, so a read costs one tenant's subtree however many neighbours there
are. `D29`'s "a few hundred tenants per node" is replaced by these numbers.

**What does grow is a tenant-level attach**, ~3 ms at 100 tenants and ~27 ms at 2 000, on every
table alike. Attaching checks the new bound against every sibling's. That is the signup DDL left
at 2 000, and it is why `PF.3` keeps **warm spares**: the founder claims a tenant whose partitions
already exist, and the signup pays one read. See `enrollers.md`.

**The runway is ~0.8 ms per tenant per table** after `PF.5`, so 1.6 s at 2 000. Ten minutes would
be several hundred thousand tenants.

**`24.7`'s pooled partition should be judged on relation count, not on those two numbers.** Plan
time is flat by design and the runway is fixed, so its old triggers would never fire. What grows
with tenants is the attach above and the lock arithmetic below.

## The lock table bounds an unpruned read

`max_locks_per_transaction` is 1 024 and `max_connections` 200, so the server has **204 800** lock
slots, shared by every backend. A statement the planner cannot prune by tenant locks every relation
under the root: each leaf and the tenant partition, each with all its indexes. Measured with
`pg_locks` after one `select count(*)` of the root:

| table | indexes | locks per tenant | at full retention | one such read fails at |
| --- | --- | --- | --- | --- |
| `notifications` | 6 | (months + 1) × 7 | 12 hot + runway ≈ 15 months → 112 | **~1 800 tenants** |
| `activity_log` | 3 | (months + 1) × 4 | 13 + runway ≈ 16 months → 68 | ~3 000 tenants |
| `messages` | 3 | (months + 1) × 4 | no retention; 24 months → 100 | ~2 000 tenants, falling |

The digest's fan-out used to issue one: a `SELECT DISTINCT organization_id` over `notifications`
with no tenant, once a day per node (`CR.22`). It pages the catalog's tenants instead now. The
nightly orphan check was the other (`CR.21`): a `select distinct` over every `messages` row on the
node. It runs one statement per tenant now, each pruned to that tenant's partitions and committed on
its own, so it holds one tenant's locks at a time. Otherwise every repository query carries the tenant, and
`pg` sends unnamed statements, so each is planned with its values and pruned at plan time. Two
things would issue one:

- **A query typed by hand**, or a tool browsing a root table. It fails with `53200`, and for as
  long as it holds the slots, so does every other backend that needs a new lock.
- **A named prepared statement against a partitioned parent.** A generic plan cannot prune at plan
  time, and the executor locks every partition before it prunes any. So a named prepared
  statement against a partitioned parent is never allowed.

The setting stays 1 024. Raising it costs shared memory; a node heading past ~1 800 tenants
should decide that with these numbers, or move tenants off with `24.2`.

**`pnpm db:partitions` is the same routine from a shell**, for the operator whose worker was down on
the first of the month. It prints a row per table per tenant:

```
┌─────────┬─────────────────┬──────────────────────────────────────┬─────────┬───────┐
│ (index) │ table           │ tenant                               │ created │ ahead │
├─────────┼─────────────────┼──────────────────────────────────────┼─────────┼───────┤
│ 2       │ 'notifications' │ '01a0b342-18da-7337-83c9-a39020f26f78' │ 2     │ 0     │
└─────────┴─────────────────┴──────────────────────────────────────┴─────────┴───────┘
1 of 4 had under two months of runway.
```

**`ahead` is what existed *before* the run**, which is the reading that matters: a zero there says
the next insert past month end would have failed. `created` is what this run had to add to fix it.
Read the other way round — after ensuring — the column could never be anything but healthy, which is
the same trap the consumer documents.

## Pruning is measured, not assumed

`packages/infrastructure/tests/pg/partition-pruning.spec.ts` captures each repository method's
statement through `DatabaseConfig.logger` — the query drizzle actually issued, not a copy written
beside it — and plans it with `EXPLAIN (FORMAT JSON)` and the real bound parameters. It asserts one
of three things per query, and **which one is the finding**:

| Assertion | Queries | What it protects |
| --- | --- | --- |
| **One tenant partition** | every tenant-scoped read | The tenant predicate — the neighbour's subtree is not in the plan |
| **Exactly one month** | `markRead`, `findById`, the activity daily rollup | An equality or a closed range on the time column |
| **The retention tail is pruned** | `listUnreadBetween`, the projection walk, `unreadCounts` | A floor — nothing older than it is in the plan |
| **Bounded by the newest message** | a conversation's first page, given `upTo` | A ceiling — nothing newer than the room's latest message is in the plan |
| **Bounded by the cursor's month** | the inbox's and a conversation's later pages | A ceiling — nothing newer than the cursor is in the plan, and the cursor is still an index condition |
| **Pinned at every month of the tenant** | the inbox's first page, a conversation's first page with no `upTo`, `countUnread`, `unreadSubjectHolders`, `markAllRead`, the outbox drain | Today's behaviour, deliberately |

The first row is the one the tenant level bought, and the spec proves it against a second tenant
that also holds rows in both months — otherwise it would pass on a database with one tenant in it
whatever the predicate said.

**A row-constructor cursor does not prune, so a later page carries a second, redundant bound.**
`(created_at, id) < (at, id)` is the keyset every inbox and conversation page uses, and the partition
pruner does not decompose it — measured at plan time and again with `EXPLAIN (ANALYZE, FORMAT JSON)`
against real parameters, where `Subplans Removed` was `0` on every row. So since `PF.6` those pages
also say `created_at <= at`, which the pruner does read, and every month newer than the cursor
leaves the plan.

**Beside the row constructor, never instead of it.** Rewritten as
`created_at < at or (created_at = at and id < $id)` the predicate prunes too, but the planner stops
keeping the cursor in the index: measured with `EXPLAIN`, the scan keeps only the tenant and user
as its `Index Cond`, on a different index, and checks the cursor row by row as a `Filter`. The spec
asserts the row constructor is still an `Index Cond` on the one leaf left, so a later edit cannot
trade the index for the pruning.

**A floor cannot prune a future month.** Rows can legitimately land in one, so `created_at >= x`
against the fifteen-partition steady state scans four — the current month, the one before it, and
the two months of runway ahead. "Exactly one" is reachable only with a floor *and* a ceiling, which
a "newest first" read does not have.

So the last row asserts what the system does today on purpose. It catches nothing on its own; it is
the change detector. A bound added later fails that assertion and is lowered deliberately, with the
numbers re-measured — rather than arriving as a badge that has quietly stopped counting old rows.

At the fifteen-partition steady state the unbounded reads cost 0.21–0.87 ms, which is why they were
left unbounded — and the tenant level narrows that set to one tenant's months rather than every
tenant's. **That steady state does not hold for `messages`**, which is never retired: its month count
only grows. So its two reads made on every render — a room's first page and the conversation list's
unread counts — carry a bound of their own, and the spec asserts each one prunes.

## `messages` had to give up an index to join the list

`messages_client_uq` on `(organization_id, conversation_id, client_id)` was the send's idempotency
key, and it cannot exist on a partitioned table without `created_at` in it — with `created_at` in it
every retry inserts a second row instead of colliding. The dedupe is a Redis `SET … EX … NX` now, and
`client_id` stays as a column with no index. See
[messaging](https://github.com/prodicle/loadbearing_tanstack_start_kit/blob/3fafa78c2f42d2d718236d7666429b858199118a/packages/application/docs/reference/messaging.md).

## Converting a table that already holds rows

The procedure is not "alter the table" — Postgres has no `ALTER TABLE … PARTITION BY`. A deployment
with rows creates a new partitioned parent, copies into it, and swaps the two under a lock. The kit
ships no rows in the seven tables `0023` rewrote, so that migration drops and recreates them in
place; a deployment that holds rows does the copy-and-swap instead.
