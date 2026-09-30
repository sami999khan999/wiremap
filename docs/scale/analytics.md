---
title: Analytics
description: Bringing back ClickHouse, the separate analytics store, so reports over time stop loading the main database.
---

# Analytics (ClickHouse)

**The limit.** Lite has no analytics store. Reports that add things up over time — activity trends,
totals per month — would have to run on the main database, and at volume they slow everything else
down. Lite's rules forbid writing those cross-tenant aggregates against Postgres at all, so today
they simply do not exist.

**When.** You need reports over time, or around 250M rows a year.

**The fix.** ClickHouse is a database built for adding up huge numbers of rows. The worker copies
events into it; reports read from it; the main database is untouched. It is **purely derived**:
it can be deleted and rebuilt from Postgres.

## What to copy

```
upstream:packages/permissions/src/catalog/analytics.permissions.ts
upstream:packages/permissions/src/gate/analytics.gate.ts
upstream:packages/permissions/src/route/analytics.routes.ts
upstream:packages/contracts/src/analytics/
upstream:packages/contracts/src/catalog/analytics.permissions.ts
upstream:packages/infrastructure/src/clickhouse/
upstream:packages/infrastructure/clickhouse-migrations/
upstream:packages/infrastructure/clickhouse-migrate.ts
upstream:packages/infrastructure/src/pg/repository/pg-projection-policy.repository.ts
upstream:packages/application/src/port/analytics.projector.ts
upstream:packages/application/src/analytics/
upstream:packages/application/src/platform/*projection*
upstream:packages/composition/src/fake/in-memory-analytics.projector.ts
upstream:packages/composition/src/fake/in-memory-projection-policy.repository.ts
upstream:packages/query/src/analytics/
upstream:packages/content/src/message/{en,bn}/analytics.ts
upstream:packages/feature/src/analytics/
upstream:packages/feature/src/platform/projection-*.tsx
upstream:apps/worker/src/consumer/analytics.consumer.ts
upstream:apps/worker/src/schedule/projection.schedule.ts
upstream:apps/web/src/server/orpc/analytics.router.ts
upstream:apps/web/src/route/(app)/_authenticated/analytics.tsx
upstream:apps/web/src/route/(app)/_authenticated/platform/analytics.tsx
```

**Grants and policy rows to hand-port:** `upstream:packages/infrastructure/migrations/0029_projection_policy.sql`
and `0039_analytics_grants.sql`.

**Env:** `CLICKHOUSE_URL`, `CLICKHOUSE_DATABASE`, `CLICKHOUSE_USER`, `CLICKHOUSE_PASSWORD`,
`CLICKHOUSE_HTTP_PORT`, `CLICKHOUSE_NATIVE_PORT`, `WORKER_ANALYTICS_CONCURRENCY`. The app builds the
ClickHouse adapter only when `CLICKHOUSE_URL` is set.

**Compose:** the `clickhouse` service, profile `analytics`. **Script:** `ch:migrate`.

> [!IMPORTANT]
> Only the projection consumer writes to ClickHouse. The moment anything else does, it has become a
> source of truth and can no longer be rebuilt.

Background: `upstream:packages/infrastructure/docs/reference/clickhouse.md`,
`upstream:docs/infra/reference/clickhouse.md`.
