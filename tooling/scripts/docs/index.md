---
title: tooling/scripts
description: The repository's gate scripts, and every place lite's check-architecture differs from the big kit's, one line per change.
---

# tooling/scripts

The scripts CI runs and a developer runs before claiming a change is done: `check-architecture.mjs`,
`check-contrast.mjs`, `comment-density.mjs`, `boot-smoke.mjs`, and the compose wrappers. What each
`check-architecture` assertion greps for, and the failure that put it there, is in
[`docs/setup/26-hygiene-and-ci.md`](../../../docs/setup/26-hygiene-and-ci.md).

## How lite's `check-architecture` differs from the big kit's

Every rule-enforcing assertion is kept. What changed is listed below, one line each, so a port
back to the big kit, or of the big kit's script into lite, knows what to reconcile.

| Assertion | Change in lite | Item |
|---|---|---|
| §15 every path the docs name exists | `docs/plans/` is exempt: a plan names files that do not exist yet | `LT5.1` |
| §20 every migration is safe on a populated table | `REPLAY_EXEMPT` is empty: the baseline creates every table it indexes | `LT2.8` |
| §27 every host port is stated once | pairs for pgBouncer, the replica, the second Redis, the second node, Loki and ClickHouse removed; one `REDIS_PORT` pairs with all three Redis URLs | `LT1.4`, `LT2.1`, `LT2.4`, `LT2.5` |
| §30 every inline widget is placed by a literal key | removed with widgets; §31 keeps its number, so the harness counts 30 | `LT1.2` |
| `.env.example` documents every key an app requires | a schema key is read at two spaces or at four, so a schema with no `.superRefine` chain is still read | `LT2.3` |
| runnable scripts above `src/` | `clickhouse-migrate.ts` removed from the list, `ai-reindex.ts` added | `LT1.4`, `LT4.5` |

The partition, placement and shard-reader assertions are unchanged, because those seams are kept.
