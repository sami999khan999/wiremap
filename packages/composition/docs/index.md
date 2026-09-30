---
title: "@loadbearing/composition"
description: The hand-written DI root that replaces a framework container. One class, no decorators, no reflection, no module graph — and the only place a vendor swap happens.
---

# `@loadbearing/composition`

The only package that knows both the abstract ports and their concrete implementations, because
wiring them together is its entire job. Every other package knows one side or the other.

That is also why it is the only place a swap happens. Moving from pgvector to Qdrant, from MinIO to
S3, from Better Auth to something else — each is one line here, and nothing upstream notices.

```bash
grep -rn "PgVectorStore" packages apps --include=*.ts
```

Hits in `packages/infrastructure` (where it is defined) and `packages/composition/src/container/` (where it is
named). Nothing between.

| | |
| --- | --- |
| **Package** | `@loadbearing/composition` (private, never published) |
| **Entrypoint** | `src/index.ts` — `Container`, `ContainerConfig`, `HealthReport`, and the test kit |
| **Depends on** | `application`, `auth`, `content`, `contracts`, `core`, `infrastructure`, `observability` |
| **Used by** | `apps/web`, `apps/worker`. **Never** `apps/desktop` — it holds no container ([30](../../../docs/setup/30-desktop-app.md)) |
| **Environment** | server-only; `ServerOnly.assert()` in `src/index.ts` is the runtime tripwire |

```
packages/composition/src/
├── index.ts                          ← ServerOnly.assert(). The container, and the test kit
├── import.ts                         ← every external symbol, both sides of every seam
├── container/
│   ├── index.ts
│   ├── container.config.ts           → ContainerConfig
│   ├── container.ts                  → Container
│   └── test-container.ts             → TestContainer, TestPorts   (off the barrel)
└── fake/                             ← one per port, all sixteen
    ├── index.ts
    ├── direct-unit-of-work.ts        → DirectUnitOfWork
    ├── in-memory-activity-replay.reader.ts → InMemoryActivityReplayReader
    ├── in-memory-analytics.projector.ts    → InMemoryAnalyticsProjector
    ├── in-memory-cache.store.ts      → InMemoryCacheStore
    ├── in-memory-log.reader.ts       → InMemoryLogReader
    ├── in-memory-storage.gateway.ts  → InMemoryStorageGateway
    ├── in-memory-vector.store.ts     → InMemoryVectorStore
    ├── recording-activity.logger.ts  → RecordingActivityLogger, RecordedActivity
    ├── recording-partition-archive.gateway.ts → RecordingPartitionArchiveGateway
    ├── recording-email.sender.ts     → RecordingEmailSender
    ├── recording-maintenance.gateway.ts → RecordingMaintenanceGateway
    ├── recording-queue.publisher.ts  → RecordingQueuePublisher, PublishedJob
    ├── stub-embedding.provider.ts    → StubEmbeddingProvider
    └── stub-session.resolver.ts      → StubSessionResolver

packages/composition/tests/
├── container/test-container.spec.ts
└── fake/fake.spec.ts
```

`import.ts` here is the longest in the repository, and that is the package working: naming a port
and its implementation exactly once is the whole deliverable.

**`fake/` and `test-container.ts` live in `src/`, and never reach `dist/`.** `tsup` builds from
`src/index.ts`, which names neither, so nothing is bundled — but `tsc` still checks them, and that is
the point: a port added to `application` is a **compile error** in `test-container.ts` until it has a
double. They do reach `dist/index.js` now that the barrel exports the harness, and neither of
`apps/web`'s bundles carries them: `tsup` emits ESM, so a consumer importing only `Container`
shakes the rest out.

## What it wires

| Field | Type it is exposed as | What it is today | Swapping it |
| --- | --- | --- | --- |
| `clock` | `Clock` | `SystemClock` | `FixedClock` in a test |
| `authorizer` | `Authorizer` | — | never; it is the kernel |
| `logger` | `Logger` | `JsonLogger` | `SilentLogger` in a test |
| `cache` | `CacheStore` | `RedisCacheStore` | one line |
| `storage` | `StorageGateway` | `S3StorageGateway` | one line |
| `queue` | `QueuePublisher` | `BullMqQueuePublisher` | one line |
| `vectors` | `VectorStore` | `PgVectorStore` | one line — pgvector → Qdrant |
| `analytics` | `AnalyticsReader` | `PgAnalyticsReader` | one line — Postgres → ClickHouse |
| `embeddings` | `EmbeddingProvider` | `OpenAiEmbeddingProvider` | one line |
| `sessions` | `SessionResolver` | `BetterAuthSessionResolver` | one line |
| `activity` | `ActivityLogger` | `PgActivityLogger` | one line |
| `unitOfWork` | `UnitOfWork` | `PgUnitOfWork` | one line |
| `content` | `ContentSource` | `StaticContentSource` | one line — static → CMS |
| `auth` | `AuthInstance` | Better Auth | rewrite `auth.factory.ts`, and nothing else |
| `capabilities` | `CapabilityCache` | — | concrete on purpose; it *is* the caching decision |
| `principals` | `PrincipalBuilder` | — | concrete on purpose; four credential types, one shape |

`database`, `redis`, `queuePublisher` and `transactions` are **private**. `dispose()` is what a
consumer gets instead, and `apps/worker` builds its own `RedisConnection` rather than reaching in.

The four rules that govern this class — abstract types on the public surface, no request state, no
`process.env`, reverse-order disposal — are in
[`docs/reference/container.md`](reference/container.md). The test shape that justifies all of it is
in [`docs/reference/test-container.md`](reference/test-container.md).

`src/mail/` is the one folder here that is more than wiring: it holds the mail layout and the
renderer, because this is the only layer that sees both the translated copy and the transport.
Why every message is a queue job, why there is no delivery table, and where the delivery record
actually lives are in [`docs/reference/mail-pipeline.md`](reference/mail-pipeline.md).

## Config arrives, it is never read

`ContainerConfig` is every value the system needs in one shape, and none of it comes from the
environment. `apps/web/src/env.ts` and `apps/worker/src/env.ts` are the only two files in the
repository that touch `process.env`; they parse it, validate it, and hand this object down.

```bash
grep -rn "process\.env" packages --include=*.ts | grep -vE "\.config\.ts|src/(migrate|seed|smoke|tables)/"
```

Returns nothing. No package reads its own configuration — Biome's `noProcessEnv`
([05](../../../docs/setup/05-lint-and-format.md)) is what keeps it true.

That is what lets you construct the entire system in a test with a fake database and a frozen clock,
and what lets the same code run in a web server and a background worker without either fighting over
environment variables.

## Every port has exactly one binding

`Container` constructs an implementation for every port `application` declares — no exceptions, no
`undefined` fields, nothing reachable that resolves to nothing. That is a property worth checking
rather than assuming: read the port list in
[`application/docs`](../../application/docs/index.md) against `container.ts` and the two should line
up name for name.

It has not always been true. `EventBus` was declared, faked in `TestContainer`, and bound nowhere —
so a use-case that published an event would have published into a recording fake under test and into
nothing at all in production. It was deleted rather than implemented, because a seam with no
implementation and no caller is what [Simplicity](../../../docs/opinions/simplicity.md) argues
against: it costs nothing today and teaches the next reader that events are a thing this system
does. The design it was reserving — a transactional outbox — shipped later, and shipped whole:
`DomainEventPublisher`, `PgOutboxPublisher` and a `Container` line in one change. That is the shape
the deletion was arguing for.
