---
title: Shard nodes
description: Moving from one database machine to several, with each organization's data living on one of them — the biggest scaling move, and the only one that needs someone to operate it.
---

# Shard nodes

**The limit.** All data lives on one Postgres machine. A bigger machine buys time, but eventually
one machine cannot take the writes.

**When.** Around 1B rows a year, or when writes approach what the largest affordable machine
handles (the big kit estimates 2–5k writes a second). Exhaust every cheaper page in this folder
first.

**The fix.** Add more Postgres machines ("nodes") and move some organizations onto them. Each
organization lives wholly on one node. A small shared database (the "catalog": users,
organizations, roles, and the map of which organization lives where) stays on node 0.

## What lite already has

This is why the move is days, not a rewrite. Lite kept all of it, running on node 0:

- Every table has `organization_id` and is partitioned by it.
- Every repository declares its placement: `catalog`, `local` or `routed`.
- `DatabaseCluster` routes each request to its organization's node — today, always node 0.
- The shard map (`shard_assignments`) with one row per organization.
- `Container.eachShard`, so jobs that touch every organization already loop over nodes.

## What to copy

The machinery for **moving** an organization between nodes, and the admin screens for it:

```
upstream:packages/application/src/port/tenant-move.gateway.ts
upstream:packages/infrastructure/src/pg/repository/pg-tenant-move.gateway.ts
upstream:packages/composition/src/fake/in-memory-tenant-move.gateway.ts
upstream:packages/application/src/platform/inspect-shard-map.use-case.ts
upstream:packages/application/src/platform/shard-map.reader.ts
upstream:packages/infrastructure/src/pg/repository/pg-shard-map.reader.ts
upstream:packages/feature/src/platform/shard-map.panel.tsx
upstream:apps/web/src/route/(app)/_authenticated/platform/shards.tsx
upstream:apps/worker/src/schedule/reconcile.schedule.ts
upstream:apps/worker/src/schedule/spares.schedule.ts
```

Compare anything else under `upstream:packages/application/src/port/shard*`,
`upstream:packages/composition/src/shard/` and `upstream:packages/infrastructure/src/pg/transaction/shard-scope.ts`
against lite's copy; lite should already have them unchanged.

**Migrations to read:** `0031_shard_assignments`, `0035_cross_shard_fk_drop`, `0036_tenant_move`,
`0038_spare_tenants`.

**Env:** `DATABASE_SHARD_<n>_URL`, `DATABASE_SHARD_<n>_DIRECT_URL`, `DATABASE_SHARD_<n>_REPLICA_URL`
for each extra node, and `SHARD_MOVE_GRACE_DAYS`. `upstream:packages/infrastructure/shard-env.ts`
reads them; lite's copy should already match.

**Compose, for rehearsing locally:** `postgres-shard-1` and `pgbouncer-shard-1`, profile `sharded`.

> [!WARNING]
> **Rehearse a tenant move on a copy of production data before doing it for real.** And be honest
> about the cost: several databases, each with its own pooler, replica and backups, is an ongoing
> operations job, not a one-off change.

Background: `upstream:packages/infrastructure/docs/reference/sharding.md`,
`upstream:plans/archive/DB-SCALING-PLAN.md`, and `upstream:plans/archive/PLAN.md` Phase 24.
