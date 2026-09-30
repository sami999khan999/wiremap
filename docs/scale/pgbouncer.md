---
title: pgBouncer
description: Putting a connection pooler in front of Postgres — config only, because lite's code is already written as if one were there.
---

# pgBouncer

**The limit.** Every web function, worker and realtime process opens its own database connections.
Postgres handles a limited number well; past that, it slows down or refuses new connections.

**When.** Past roughly 100 connections, or when the app logs `database.pool.saturated`. On Vercel
this arrives early, because every serverless instance has its own pool.

**The fix: config only.** Lite's rules already require code to behave as if pgBouncer sat in front
in transaction mode: no session-level `SET`, `SET LOCAL` inside a transaction, and DDL through
`DATABASE_DIRECT_URL`. See [`docs/ai/rules/data.md`](../ai/rules/data.md).

1. Copy the `pgbouncer` service from `upstream:infra/docker-compose.yml`, with `PGBOUNCER_PORT`.
2. Point `DATABASE_URL` at pgBouncer. Leave `DATABASE_DIRECT_URL` pointing at Postgres itself;
   migrations and DDL use it.
3. Check that lite's baseline migration carries the role-level `statement_timeout` default from
   `upstream:packages/infrastructure/migrations/0022_pooler_timeout_floor.sql`. pgBouncer drops the
   startup parameter that sets it otherwise, and queries run with no timeout. Port it if missing.

> [!NOTE]
> **On Neon, this is already done.** Neon's pooled connection string is pgBouncer in transaction
> mode. Use it for `DATABASE_URL` and the direct string for `DATABASE_DIRECT_URL`.

Background: `upstream:docs/infra/reference/pgbouncer.md`.
