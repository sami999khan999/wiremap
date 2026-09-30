---
title: Data and scale
description: Which store owns which data, what is derived, and what is non-negotiable in any new schema — in the lite kit, where the scale stores are not running but every seam is.
---

# Data and scale

> **Postgres owns anything a transaction depends on or a user reads immediately after writing.
> Everything else is a derived store behind a port.**

| Stream | Written by | Store in lite | Store at scale-up |
|---|---|---|---|
| Domain data | use-cases | Postgres | same |
| Audit trail | `ActivityLogger` | Postgres, partitioned, **in-transaction** | same |
| Domain events | `DomainEventPublisher` | Postgres outbox, partitioned, **in-transaction**, at-least-once, drained by the worker | same |
| Diagnostics | `JsonLogger` | stdout only | stdout → Loki |
| Analytics | — | **not built** | worker → Postgres snapshots → ClickHouse |
| Retired months | — | **not built**: partitions are kept, never dropped | archive-then-drop to S3 `cold/` |

**The test:** if dropping a store loses information not recoverable from Postgres or S3, it has
become a source of truth — whether you decided that or not. Run it whenever a store is added, and
again the first time someone introduces one because "it is just a cache."

- **One Redis instance, two jobs, two names.** Capability and session caches are rebuildable;
  **BullMQ is not** — a lost job is work that never happens. Sharing one instance is safe only
  under `maxmemory-policy noeviction`, so **every cache key carries a TTL** and nothing relies on
  eviction. Code reads `REDIS_CACHE_URL` or `REDIS_QUEUE_URL` by purpose, never one for the other:
  splitting them is then an `.env` change. An evicted session must be a read-through, never a
  sign-out.
- **Nothing in lite drops a partition.** There is no retention pass, so no code may delete a
  month or a tenant's rows except the tenant delete itself. Retention arrives with its archive,
  from [`docs/scale/`](../../scale/index.md), never as a bare `DROP`.
- **Never write a query that cannot be scoped to a tenant.** A cross-tenant aggregate in
  application code cannot be sharded; it waits for the analytics store instead of being written
  against Postgres now.

**Non-negotiable in any new schema:** `organization_id` on every domain table as a branded
`OrganizationId` · an index **leading with** every foreign key and filtered column, since Postgres
does not auto-index FKs and a composite that leads with the tenant cannot serve a cascade ·
**every tenant-owned table `PARTITION BY LIST (organization_id)` in the migration that creates it**,
and the ones that grow *with activity* `PARTITION BY RANGE` again underneath, because converting
later is a rewrite with downtime — the parents are the migration's, every child is
`TenantPartitionSeed`'s · query-count assertions in integration tests for anything that loops ·
**no tenant foreign key from a routed table to the catalog**, and **no foreign key into a
tenant-partitioned table** — both hold on one node exactly as on many. Between catalog siblings,
`NO ACTION`, never `RESTRICT`. The audit trail names no actor by foreign key either.

- **Write every connection as if pgBouncer sat in front in transaction mode.** Lite dials Postgres
  directly, and that is the only reason a session-level `SET` would appear to work. **It is banned
  anyway**: `SET LOCAL` inside a transaction is how work raises a timeout, and DDL a transaction
  cannot carry goes to `DATABASE_DIRECT_URL`. Adding the pooler is then compose plus `.env`.
- **Every table is `catalog`, `local` or `routed`, and the repository declares which.**
  `application/src/primitive/shard.ts` is the only list; `routed` is the default. A repository
  reads tables of one placement — a CI assertion — and `BaseRepository.db` throws when a catalog
  repository is used inside a routed transaction. **Lite runs one node and that still throws**,
  which is the point: the call site is found in a test run, not the week of a split.
- **A read that crosses placements runs *before* the transaction, never inside it.** Two statements
  — the routed ids, then the catalog resolve — not one join.
- **A cross-tenant pass loops nodes, not tenants** — `Container.eachShard`, serially, even though
  lite has one.

**Do not build in advance:** ClickHouse, Loki, a dedicated vector DB, a replica, a second shard
node, pgBouncer, a broker. **The seams are built; the stores are not running.** *"The seam is
implemented"* and *"the store is running"* are two decisions, and only the second costs anything
to be wrong about. Each store comes back by its page in [`docs/scale/`](../../scale/index.md).

---

**The argument.**
[`docs/opinions/data-and-scale.md`](../../opinions/data-and-scale.md) — which store owns which data, what is derived, the order scaling moves happen in.

When this file and `docs/opinions/` disagree, **`docs/opinions/` wins and this file is stale;
say so.**
