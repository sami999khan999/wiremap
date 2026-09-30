---
title: Retention
description: Bringing back retention and cold storage, so old months move out of the database into cheap file storage instead of growing forever.
---

# Retention and cold storage

**The limit.** Lite never removes old data. Activity logs, events and notifications grow every
month, and the database — the most expensive storage you run — holds all of it.

**When.** Database storage becomes a real cost, or old partitions slow down maintenance.

**The fix.** Each month, a worker job takes old monthly partitions, writes them to S3 as compressed
files under `cold/`, checks the copy, records it in `partition_archive`, and only then drops the
partition. **Archive, verify, then drop — never plain delete.** Platform admins set how long each
table keeps data, globally and per tenant.

## What to copy

```
upstream:packages/infrastructure/src/pg/schema/archive.schema.ts
upstream:packages/infrastructure/src/pg/repository/pg-partition-archive.gateway.ts
upstream:packages/infrastructure/src/pg/repository/pg-retention-policy.repository.ts
upstream:packages/infrastructure/src/pg/repository/pg-tenant-retention-policy.repository.ts
upstream:packages/infrastructure/src/s3/s3-cold-archive.reader.ts
upstream:packages/application/src/port/partition-archive.gateway.ts
upstream:packages/application/src/port/cold-archive.reader.ts
upstream:packages/application/src/platform/*retention*
upstream:packages/application/src/notification/list-archived-notifications.use-case.ts
upstream:packages/composition/src/fake/in-memory-cold-archive.reader.ts
upstream:packages/composition/src/fake/*retention-policy.repository.ts
upstream:packages/composition/src/fake/recording-partition-archive.gateway.ts
upstream:packages/feature/src/platform/*retention*.tsx
upstream:packages/feature/src/notification/archived-notification.list.tsx
upstream:apps/worker/src/schedule/retention.schedule.ts
upstream:apps/web/src/route/(app)/_authenticated/platform/retention.tsx
```

**Migrations to read for grants, policy rows and role setup:** `0021_cold_guardian`,
`0024_tenant_activity_archive`, `0025_cold_storage`, `0027_retention_policy`,
`0028_tenant_retention`, `0032_archive_tombstone`, `0034_activity_archive_drop`. Several of them
create something a later one drops — port the *final* shape, per [Porting](porting.md) step 3.

**Env:** `S3_COLD_STORAGE_CLASS`, `S3_COLD_TRANSITION_DAYS`. **Compose:** `minio-cold` and
`minio-cold-init`, profile `cold-tier`.

> [!CAUTION]
> **A deleted tenant keeps its cold files for thirty days, counted from the delete**, and the tenant
> delete must sweep them itself — the archive index has no foreign key to cascade from. Port that
> part with the rest, not later.

Background: `upstream:packages/infrastructure/docs/reference/cold-storage.md`.
