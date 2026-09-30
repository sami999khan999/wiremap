---
title: Read replica
description: Adding a read-only copy of the database so heavy reads stop competing with writes — config first, and possibly one admin panel to port.
---

# Read replica

**The limit.** Every read and every write goes to the one database. Heavy reads — dashboards, lists,
search — compete with writes for the same machine.

**When.** Pages slow down while writes are busy, or database CPU is dominated by reads.

**The fix.** A replica is a read-only copy of the database that follows the primary. The routing to
it lives in `DatabaseCluster`, which lite keeps.

1. Copy the `postgres-replica` service (profile `replica`) from `upstream:infra/docker-compose.yml`,
   and `upstream:infra/pg_hba.conf`, which lets the replica connect for replication.
2. Set `DATABASE_REPLICA_URL` and `POSTGRES_REPLICA_PORT`. With it unset, all reads go to the
   primary — which is lite's behaviour today.
3. Replica reads are switched on and off at runtime by a platform admin. If lite's platform pages
   no longer have the switch, port it:

```
upstream:packages/application/src/platform/toggle-replica-reads.use-case.ts
upstream:packages/feature/src/platform/replica-switch.panel.tsx
```

> [!WARNING]
> **A replica lags behind the primary.** Anything a user reads straight after writing must still go
> to the primary — that is the read-after-write rule in [`docs/ai/rules/data.md`](../ai/rules/data.md).
> `DatabaseCluster` already guards this: it reads from the replica only once the replica has
> replayed everything the primary had, and falls back to the primary otherwise. Do not route around it.

On managed Postgres (Neon and others), a replica is a provider feature: create it there and put its
URL in `DATABASE_REPLICA_URL`.
