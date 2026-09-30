---
title: Beyond the big kit
description: The scaling moves the big kit has designed for but not built — new work in either kit, landing as new adapters rather than a rewrite.
---

# Beyond the big kit

Everything else in this folder is **copy back what the big kit already has**. These moves are
different: the big kit has a seam (a port) ready for each one, but no implementation. Doing them is
new work in both kits.

The big kit's own list is `docs/opinions/data-and-scale.md` §5, *Build when it hurts*, which this
repository carries: [`docs/opinions/data-and-scale.md`](../opinions/data-and-scale.md).

| Move | Seam it plugs into | Trigger |
|---|---|---|
| **KPI snapshot tables** | a reader port per dashboard | A dashboard over 1s on a warm cache |
| **ClickHouse for ad-hoc reads**, behind a new `AnalyticsReader` | analytics | Snapshots stop covering the questions asked |
| **A dedicated vector database** (Qdrant or similar) | `VectorStore` | pgvector search gets slow or inaccurate |
| **A message broker** (Kafka, Redis Streams) in place of the Postgres outbox | `DomainEventPublisher` | The outbox cannot keep up with events |
| **Redis Cluster** | the Redis URLs, already split by job | One Redis per job is not enough |
| **High availability for the apps** | none — this is hosting | A single server outage is not acceptable |

**The rule for all of them:** build it behind the existing port, as a new adapter selected in
`packages/composition`. No use-case changes. If one seems to need a use-case change, the port is the
wrong shape — fix the port in both kits first.

> [!IMPORTANT]
> The big kit's own verdict: the architecture holds at around 100,000 daily active users, but running
> sharded Postgres, ClickHouse, a Redis cluster and many app instances is a platform team's job. The
> architecture saves you a rewrite; it does not save you the people.
