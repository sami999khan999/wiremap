# Upstream

This kit, **loadbearing lite**, was cut from the big kit, **loadbearing**, and lives in its own git
repository. This file records exactly where it came from, so anything removed can be brought back
from the right place.

| | |
|---|---|
| Big kit repository | <https://github.com/prodicle/loadbearing_tanstack_start_kit> |
| Cut from commit | `3fafa78c2f42d2d718236d7666429b858199118a` |
| Commit date | 2026-09-30 |
| How it was cut | [`docs/plans/LITE-KIT-PLAN.md`](docs/plans/LITE-KIT-PLAN.md) |
| How to bring things back | [`docs/scale/`](docs/scale/index.md) |

## What was removed

| Removed | Why | Bring it back with |
|---|---|---|
| Second Redis instance | one Redis serves cache, queue and realtime | [Split Redis](docs/scale/split-redis.md) |
| pgBouncer | direct connection; code already pooler-safe | [pgBouncer](docs/scale/pgbouncer.md) |
| Read replica | one database | [Read replica](docs/scale/read-replica.md) |
| ClickHouse analytics | no analytics store | [Analytics](docs/scale/analytics.md) |
| Retention, cold storage | partitions are kept, never archived | [Retention](docs/scale/retention.md) |
| Loki, Alloy | logs to stdout only | [Logs](docs/scale/logs.md) |
| Tenant moves, extra shard nodes | routing kept, running node 0 only | [Shard nodes](docs/scale/shard-nodes.md) |
| Messaging | not selected | [Messaging](docs/scale/messaging.md) |
| Widgets and zones | not selected; the dashboard is static | [Widgets and zones](docs/scale/widgets.md) |

## Ported back since the cut

| Date | What | From commit |
|---|---|---|
| — | nothing yet | — |

## Added in lite, owed to the big kit

The UI stack, Tailwind and Base UI, was back-ported on 2026-10-01; see the table there.

See [`docs/scale/back-ports.md`](docs/scale/back-ports.md).
