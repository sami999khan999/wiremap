---
title: Sharding
description: One key, one node, three placements — how a query finds its database, and the tripwire that makes a single-Postgres deployment reveal every use-case a split would break.
---

# Sharding

Nothing here is about running more than one Postgres. It is about being able to, later, without
finding out then which twenty use-cases assumed one.

| Piece | Where | What it answers |
|---|---|---|
| `ShardingStrategy` | `composition/src/shard/` | what a request is placed *by* |
| `ShardResolver` | `pg/repository/pg-shard.resolver.ts` | which node that key lives on |
| `shard_assignments` | `pg/schema/shard.schema.ts` | the directory both read |
| `ShardScope` | `pg/transaction/shard-scope.ts` | which shard the ambient work belongs to |
| `DatabaseCluster` | `pg/primitive/database-cluster.ts` | the pool for a node |
| `TablePlacement` | `application/src/primitive/shard.ts` | which of the three a *table* is |

## The organization is the shard, and there is no number in between

Decision D28 removed the virtual shard. A key resolves straight to a physical node, so
`shard_assignments` is `(shard_key, node)` and nothing has to be told how many virtual buckets
exist or rebalanced when that changes.

The cost is that moving one tenant would be moving one tenant's rows, with no batching of a
thousand at a time. The benefit is that there is no second numbering scheme to keep in step, and the directory
is legible: one row per customer, naming a machine.

## `keyOf` runs once per request, and so does `resolve`

The strategy runs in the middleware after the principal is built, and the resolve runs there too.
Both results go into `ShardScope` together, as `{ key, node }`.

**That is what lets `BaseRepository.db` stay synchronous.** A resolver called per query would make
every repository method await a directory lookup before it could pick a pool; called once, the
node is already known and `this.db` is a property read. One `await` per request rather than one
per query, and the 183 call sites that read `this.db` never learned that sharding exists.

The cache is a read-through on `shard:key:<key>` with a **300-second** TTL —
`CapabilityCache`'s shape and deliberately not its sixty seconds. A capability changes when
somebody edits a role; a placement changes only when a tenant is moved, which lite has no job for,
and which carries an explicit `invalidate` when it happens.

## Three placements, and the tripwire between them

Every table is `catalog`, `local` or `routed`, and `TablePlacement.of` is the only thing that
says which. Each repository **declares** its placement rather than deriving one, because a
repository that guessed would guess wrong exactly once.

- **catalog** — what a principal is built from before a key is known, plus RBAC, the two
  tenant-less lookups, the archive index, the policy rows, flags, entitlement and doc grants.
Twenty-four tables.
- **local** — present on every node, written in whichever transaction is open: `activity_log`
  and `outbox_event`.
- **routed** — everything a tenant produces. It is the **default**, so a new slice's table needs
  no edit here, and an unplaced table routes rather than silently reading the catalog.

`BaseRepository.db` compares its own placement against the open transaction's and throws when
they disagree. `local` is compatible with both of the others, which is what its name means.

`tests/primitive/placement.spec.ts` is what holds all of this: a routed read with no key throws,
so does a routed `run`, a catalog read inside a routed transaction throws, a routed transaction
nested in a catalog one throws — and the same-placement case still goes through, which is the
assertion that keeps the other four from being satisfied by breaking everything.

**The point is that this throws on one node.** A catalog repository used inside a routed
transaction is not a bug today — one Postgres holds both — and it is a data-corruption bug the
day there are two. Failing now, in every environment, is the difference between finding those
call sites in a test run and finding them in production.

`PgUnitOfWork` carries the same rule one level up: a routed `run` nested inside a catalog one
throws rather than becoming a savepoint. A catalog use-case calling a routed one inside its
transaction is precisely the coupling a split cannot honour.

## No read crosses a placement

The big kit had one: a recipient read that joined a routed table to catalog `users` and
`memberships`. It was split into two statements, then left with messaging — see
[notification recipients](notification-recipients.md). So `CROSS_PLACEMENT_KNOWN` in
`check-architecture` §22 is **empty**. An assertion with an exception set that is never emptied
records a rule rather than guarding one.

## A sweep is placed on a node, not on a tenant

`ShardScope` holds `{ key, node }`, and `key` is `null` in a cross-tenant pass:
`ShardScope.atNode` is what the outbox drain, the partition runway and the digest fan-out run
inside, through `Container.eachShard`. Serial, not `Promise.all` — these are DDL and drain passes,
and running them against every node at once multiplies this process's pool by the shard count.
A node that throws is logged as `shard.sweep.failed` and skipped; the rest still run, and the first
error is rethrown at the end, so one node down delays only its own work.

Inside a node-only scope a `local` table resolves to that node's pool rather than the catalog's,
which is the whole point: `outbox_event` and `activity_log` exist on every node and the row you
want is on the one you are walking. Outside any scope both fall back to node 0. Which passes loop
and which deliberately do not is [the consumers](../../../../apps/worker/docs/reference/consumers.md).

### `catalogDb` is the one sanctioned crossing

`PgPartitionArchiveGateway` detaches a partition on the node it is walking and records the object
in `partition_archive`, which is catalog. That is a genuine span, not an accident, and
`BaseRepository.catalogDb` is where it goes: it throws for any placement but `local`, and it
returns the catalog pool's client rather than the open transaction's — that transaction is on the
node being swept, and the index row does not live there.

It is deliberately the only one. A routed repository reaching the catalog is what the split
reader above avoided, and the guard makes that call a throw rather than a review comment.

## `PgShardResolver` is not a `BaseRepository`, and takes thunks

It is what `DatabaseCluster.forKey` calls. A resolver that routed would ask itself where it
lives, so it reads the catalog pool directly.

It takes `() => Database`, `() => CacheStore` and `() => Logger` rather than the values, because
the container builds the cluster **with** this resolver: neither the pool nor the cache exists
when it is constructed. The thunks are called later, on a request, by which time the container
is fully assembled.

## A missing directory row is an error, not node 0

Every tenant gets a row from the founder, in the same transaction as its `organizations` row. So a key with no row is a tenant nobody placed — a bug in the founder, not a state to
recover from.

Guessing zero would work today and put a tenant's rows on the wrong machine the day it does not.
`shard.resolution.failed` is logged at `error` and the read throws.

## A tenant delete sweeps its own directory row

`shard_assignments.shard_key` is `text` with no foreign key, which is what lets a fork put a
region code in it — and it means nothing cascades. `PgTenantRepository.delete` therefore does two
statements: the directory row, then the organization. Without the first, the table grows with
tenant churn forever.

It is the same reasoning `partition_archive` follows and the opposite conclusion, because the two
have opposite lifetimes. A cold object outlives its tenant on purpose — thirty days of recovery
window, swept by the nightly pass. A directory row for a tenant that no longer exists answers a
question nobody can ask.

## The directory is read by id or slug

`PgShardMapReader.findByTerm` is the one read of the directory beside the resolver. The platform's
tenant lookups — plan, entitlement, flag target — take an organization id **or** a slug and use it
to find the tenant and its node.

It compares `organizations.id::text = $1`. Never `$1::uuid`: a slug cast to a uuid is a `22P02`
from the database rather than the empty answer a typed search should get.

The big kit also had a `/platform/shards` screen that counted tenants per node. It left with the
tenant move; see [Shard nodes](../../../../docs/scale/shard-nodes.md).

## The write freeze, kept for a move

Lite has no tenant move. It kept the part a move needs from every write path, so porting one back
needs no migration and no change to a repository — see
[Shard nodes](../../../../docs/scale/shard-nodes.md).

**The freeze is a refusal, not a queue.** `shard_assignments.moving_to` non-null means the tenant is
being moved. `PgShardResolver` answers `frozen: true` for it, and `PgUnitOfWork.run` throws
`ForbiddenError("shard.move.inFlight")` for any `routed` or `local` write. Reads keep answering from
the current node. A catalog write is never refused: a move copies no catalog row, so it cannot lose
one. Nothing in lite sets `moving_to`.

**So every routed write goes through `run`, including a single statement** (`CR.11`). The freeze is
checked there and nowhere else — `BaseRepository.db` cannot tell a read from a write, and refusing
reads would take the tenant down for the whole move. A routed write with no unit of work would land
on the source during a move, and an *update* is invisible to a count check, so it would be lost at
the flip. A new routed write that skips `run` is that bug again.

**A job re-reads its placement at every transaction — `24.2b`.** A request places itself once and
finishes in seconds. A worker job can keep opening transactions for much longer. So `withShard`
places a job with `recheck`, and `PgUnitOfWork.run` re-reads the placement each time it opens a
transaction. If the tenant is frozen, or its node has changed, it throws and the job is retried. A
savepoint does not re-read, and neither does a catalog transaction. The cost is one cached resolve
per job transaction.

**A catalog transaction's audit row goes through the outbox for a tenant off node 0 — `24.2a`.**
An invitation, a role change or an API key is a catalog transaction, and a catalog transaction is
on node 0 whichever node the tenant is on. Written straight into `activity_log` there, a tenant on
another node would have audit rows where its runway and its archive never look. So
`PgActivityLogger` asks the directory where the tenant is. For a tenant off node 0 it publishes
`activity.recorded` into node 0's outbox instead, in the same transaction. The drain delivers it to
`ActivityRelaySubscriber`, placed on the tenant, which writes it on the tenant's node with the
event's id and time and `on conflict do nothing`. A tenant on node 0 is unchanged.

**A placement already in scope for the tenant is the answer, and the resolver is asked only without
one.** The founder depends on that. Its directory row is uncommitted when it writes
`organization.created`, and the resolver reads through its own pool. On two nodes every sign-up
failed with "No shard assignment" until the founder placed the audit on node 0 itself.

## What routing costs a request, measured

```bash
# a second Postgres, and DATABASE_SHARD_1_URL in .env naming it
ROUTED_SCALE=1000 pnpm smoke
```

`tests/smoke/routed.smoke.spec.ts`, averaged over a thousand resolutions against two nodes on one
developer machine, measured in the big kit:

| Path | Per call |
|---|---|
| **warm** — one cache read | 679 µs |
| **cold** — cache read, catalog query, cache write | 2 568 µs |
| a cache invalidate, for reference | 667 µs |

The absolute numbers are this machine's: Redis in Docker on Windows, where **one round trip is
about 0.67 ms**. The invalidate row is there to say so — it is one `DEL` and nothing else, and it
costs the same as the warm resolve. On a deployment where Redis answers in 100 µs, both rows move
together.

**The shape is the finding, and it is the right one.** A routed request pays *one cache read* to
learn where it lives, never a query; a miss costs three round trips rather than one, and happens
once per key per five minutes. `resolve` runs once per request, not once per query — see above —
so this is the whole of what routing adds.

**The walk is serial and the reading says so**: two `count(*)`s across two nodes, 135 ms, one node
after the other. That is `Container.eachShard`, and a pass that fanned out would hold a connection
open on every node at once.

### Writes under load — `24.6`

`24.1` dropped the keys that made a routed insert on node 1 fail, so the write half runs now.
Eight tenants, four per node. Each write is the path a request takes: a placement read through the
real Redis cache, then a routed transaction inserting one notification. Each node's pool is 20, the
shipped `DATABASE_POOL_MAX`. 1× is four writers at once and 10× is forty, 1 000 writes each,
`ROUTED_SCALE=1000`:

| Level | Writers | Writes/s | p50 | p95 | p99 | Errors |
|---|---|---|---|---|---|---|
| 1× | 4 | 23 | 151 ms | 324 ms | 467 ms | 0 |
| 10× | 40 | 142 | 265 ms | 498 ms | 577 ms | 0 |

**Routing is not where the time goes.** The warm resolve above is under 1 ms of a write's 150. The
rest is the commit's `fsync`, and on Docker Desktop on Windows that alone is about 100 ms. It is
also why a crashed catalog container spends minutes in recovery here. Ten times the writers buys six
times the throughput, because concurrent commits share a flush. Latency grows by less than 2×.

**What the test asserts is not the numbers.** They are this machine's disk. The assertions are
that no write fails at either level, and that every acknowledged row is on its tenant's node and
none is on the other. A routing slip under load would be a row that reads back from nowhere. A
node that is *provisioned*, rather than a second container on one machine, is `S.3`'s remaining
half, and its numbers are the ones a capacity plan should use.

## Sharding by something else: four edits, and nothing else

A fork that shards by region, by plan, or by anything other than the organization changes four
places. Nothing else in the repository names the choice, which is the property this whole seam
exists to have.

1. **`TenantKey` on the allowlist** — `application/src/primitive/partitioned-table.ts`, today
   `"organization_id"`. It is the column name every tenant-owned table partitions by, and
   `PartitionedTable` reads it to compose the `PARTITION BY LIST` clause. Change it and every
   table's partition key changes with it.
2. **One strategy class** — `composition/src/shard/organization.strategy.ts`, whose whole body is
   `Shard.keyOf(principal.organizationId)`. `keyOf(principal)` is what the middleware calls once
   a request has a principal, and a deployment sharding on region returns the region here.
3. **`TENANT_COLUMN` in `check-architecture.mjs`** — the assertion that every domain table carries
   the column and that every unique index leads with it. Asserted equal to `TenantKey`, so the
   two cannot drift.
4. **The worker's key derivation** — `packages/composition/src/consumer/queue.consumer.ts`, which turns a
   job's payload into a principal. A job carries an organization id today; a region-sharded fork
   carries whatever its strategy reads.

**`shard_key` is opaque text and does not change.** The directory column is `text`, not a uuid and
not a foreign key, precisely so a fork can put a region code in it without a migration. And both
the generator and the seed read the alias rather than spelling the column, so neither is a fifth
place.

## Read replicas

A read replica is a second copy of a node that follows the primary and answers reads. **The
problem with one is staleness.** It replays the primary's changes a moment late, so a row
committed on the primary may not be on the replica yet. A job that writes a row and then reads it
back from the replica would not find it.

**So a read uses the replica only once it has caught up — `DatabaseCluster.readerAt`.** Before
the read, it asks the primary for its current write position (`pg_current_wal_lsn()`), then asks
the replica whether it has replayed that far (`pg_last_wal_replay_lsn()`). If it has, the replica
holds everything the primary held when the read began, and it answers. If it has not, or cannot
be reached, the primary answers. No caller reasons about lag, because the read is never staler
than the primary it stands in for. `replica.smoke.spec.ts` proves it against a live standby. A
row inserted on the primary is found by the read straight after it, and again by the first read
the replica is chosen for. With the check removed, the first read misses the row.

| | cost |
|---|---|
| no replica configured, or the switch off | nothing — the same pool as before |
| a replica read | two round trips before the query, neither touching a table |
| a replica that is behind or down | those two, then the primary |

**Three things decide whether a read goes there.** A replica must be configured for the node:
`DATABASE_REPLICA_URL` for node 0, `DATABASE_SHARD_<n>_REPLICA_URL` for node n. The work must be
placed with `replica: true`. And the repository must ask for it, through `BaseRepository.reader()` rather
than `db`. Inside a transaction `reader()` is the transaction, because a transaction reads its own
writes.

**What reads there today is the public docs.** `apps/web/src/server/doc.fn.ts` places the
platform's doc reads with `replica: true`, and `PgDocPageRepository.findPublished` and `search`,
and `PgDocSpaceRepository.list` and `findBySlug`, read through `reader()`. The worker's `withShard`
accepts the option, and no job passes it today. The status panel also opens the replica pool for
its lag, which is `now() - pg_last_xact_replay_timestamp()`, and zero when the replica has replayed
everything it has received. An idle primary sends nothing, so the timestamp alone would read as
growing lag on a replica that is fully caught up.

Unset, `DATABASE_REPLICA_URL` means every read goes to the primary. Lite's compose file starts no
standby; adding one is [Read replica](../../../../docs/scale/read-replica.md).

## Rehearsing the split

Lite's compose file starts one Postgres. Start a second one yourself, set `DATABASE_SHARD_1_URL`,
and `pnpm db:migrate` applies the same schema to both. `tests/smoke/sharded.smoke.spec.ts` is what runs against it — gated on
`Stack.shard1`, provided by `vitest.smoke.config.ts`, because `check-architecture` §3 walks
`tests/` for `process.env` and that injection is the only door.

It creates two tenants, writes their directory rows naming node 0 and node 1, and asserts:

- each key resolves to the node its row names;
- `shard_assignments` exists on the catalog and **not** on shard 1;
- a notification written under a tenant placed on node 0 lands on node 0 and on no other node;
- a routed write under the tenant on node 1 lands on node 1, with no key reaching back to the
  catalog.

**That last one used to assert the opposite.** Ten foreign keys crossed from a shard to the
catalog, and a routed insert on node 1 failed with `23503` before it could land. Decision `24.1`
dropped all ten, so the case inverted — and it still fails on the old schema, which is the point
of keeping it.

It also creates a month partition on the node the runway is walking, and drains a tenant's event
from the outbox on the node it was written to.

## What is not built, and why it is not

**No placement policy.** Which node a *new* tenant lands on is a decision nobody has to make
while there is one node, and an interface with one implementation and no prospect of a second is
what [Simplicity](../../../../docs/opinions/simplicity.md) names as ceremony. It earns its place
at the split.

**No second node in the default stack.** `DATABASE_SHARD_<n>_URL` is read and the cluster indexes
what it finds, but `pnpm infra:up` starts one Postgres. A second is a rehearsal rather than a
deployment — see above, and [Shard nodes](../../../../docs/scale/shard-nodes.md) for the real move.
