---
title: Scaling up
description: What the lite kit cannot do at larger scale, and how each limit is fixed by bringing back a piece of the big kit — written to be read without access to the big kit's repository history.
---

# Scaling up

This kit is **loadbearing lite**. It was cut from a larger kit, **loadbearing** ("the big kit"),
and lives in a separate git repository. This folder is the bridge between the two: every limit the
lite kit has, and the big-kit piece that fixes it.

| | |
|---|---|
| Big kit repository | <https://github.com/prodicle/loadbearing_tanstack_start_kit> |
| Cut from commit | `3fafa78c2f42d2d718236d7666429b858199118a` (2026-09-30) |
| Record of the cut | [`UPSTREAM.md`](../../UPSTREAM.md) |

> [!IMPORTANT]
> **Always port from the commit above, not from the big kit's latest `main`.** The lite code is that
> commit's code with pieces removed. Porting from a later commit means reconciling everything the big
> kit changed since, on top of the port. See [Porting](porting.md).

## How the two kits relate

**Lite removes stores, never seams.** The big kit is built for scale: several databases, a separate
analytics store, central logs, archiving. Lite keeps the same code shape and stops *running* those
extra services.

- **Same packages, same `@loadbearing/*` scope, same file and class names.** A big-kit file copied
  into lite needs no import changes.
- **Same database shape.** Every table has `organization_id`, tables are partitioned by
  organization, and every repository declares whether it is `catalog`, `local` or `routed`. Lite
  runs all of it on one database.
- **Same env var names.** `REDIS_CACHE_URL`, `REDIS_QUEUE_URL` and `REDIS_REALTIME_URL` all exist
  and all point at one Redis. `DATABASE_URL` and `DATABASE_DIRECT_URL` both exist and point at one
  Postgres.

That is why most fixes below are **config** or **copy files back**, never a rewrite.

## Paths in this folder

Paths to files in **this** repository are written normally: `docs/ai/rules/data.md`.
Paths to files in **the big kit** at the commit above are written with an `upstream:` prefix:
`upstream:packages/infrastructure/src/clickhouse/`. Those files are not here; open them in the big
kit's repository at that commit.

## The limits, and what fixes each one

In plain terms. The thresholds are the big kit's own planning estimates
([`docs/opinions/data-and-scale.md`](../opinions/data-and-scale.md) §3), not measurements.

| Lite limit | When it starts to hurt | Fix | Kind of work | Page |
|---|---|---|---|---|
| **One Redis does two jobs** — cache and job queue share memory | The cache grows large enough to crowd the queue | Run a second Redis | Config only | [Split Redis](split-redis.md) |
| **Too many database connections** | Past ~100 connections | Put pgBouncer in front of Postgres | Config only | [pgBouncer](pgbouncer.md) |
| **Reads compete with writes** on the one database | Dashboards slow down writes | Add a read replica | Config, maybe one panel | [Read replica](read-replica.md) |
| **Heavy reports slow the main database** | Around 250M rows a year, or when reports take seconds | Bring back ClickHouse analytics | Copy files back | [Analytics](analytics.md) |
| **Old data is never archived** — tables grow forever | When database storage costs real money | Bring back retention and cold storage | Copy files back | [Retention](retention.md) |
| **Logs only go to the screen** | Running more than one server | Bring back Loki and Alloy | Config plus a small copy | [Logs](logs.md) |
| **One database machine** holds everything | Around 1B rows a year, or writes past what one machine takes | Add database nodes and move organizations onto them | Copy files back, then operate | [Shard nodes](shard-nodes.md) |

Two product features were also left out of lite. They are not scale limits, but they come back the
same way: [Messaging](messaging.md) and [Widgets and zones](widgets.md).

**Do them in roughly this order.** The config-only moves first; they are cheap and reversible.
Replica and analytics next. Shard nodes last — they are the only move that needs someone to operate
several databases.

## What the big kit does not fix

1. **Free-tier hosting limits.** Vercel Hobby is non-commercial only; Neon, mail and embedding free
   tiers have quotas. Those are fixed by paying, not by code.
2. **A single server going down.** If the worker and realtime run on one VM, that VM is a single
   point of failure. Running two, or a managed host, is a deployment decision in either kit.
3. **Moves the big kit has not built either** — see [Beyond the big kit](beyond-the-big-kit.md).
4. **Features only lite has.** They flow the other way, from lite into the big kit — see
   [Back-ports](back-ports.md).

## See also

- [Porting](porting.md) — the general procedure every page here follows.
- [`docs/ai/rules/data.md`](../ai/rules/data.md) — the rules that keep these fixes config-only.
- [`docs/opinions/data-and-scale.md`](../opinions/data-and-scale.md) — the big kit's full argument
  for which store owns what, and the order scaling moves happen in.
- [`docs/plans/`](../plans/index.md) — the plan that produced this kit.
