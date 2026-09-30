---
title: "@loadbearing/worker"
description: The background process. Three consumers, five schedules, one container — and a single recurring failure it is shaped to prevent: work that stops quietly and looks exactly like work that is running.
---

# `@loadbearing/worker`

**This app answers one question: what runs when nobody is watching?** It holds no business logic —
every consumer is a thin adapter that deserialises a job, builds a `SystemPrincipal`, and calls a
use-case, exactly as an oRPC router does.

One failure mode shapes almost every decision in it:

> A schedule with no consumer accumulates silently. A consumer with no store succeeds silently.
> Both look identical, from the outside, to a pipeline that is working.

| | |
| --- | --- |
| **Package** | `@loadbearing/worker` (private, never published) |
| **Entrypoint** | `src/main.ts` — nothing imports this app |
| **Loose at `src/`** | `main.ts` and `env.ts` only, both resolved by name — see [Folders](../../../docs/opinions/folders.md) |
| **Depends on** | `@loadbearing/{application,composition,content,contracts,infrastructure,permissions}`, plus `bullmq` |
| **Environment** | node only. The one process that reads `SERVER_CATALOG` |
| **Setup doc** | [25 · The worker app](../../../docs/setup/25-worker-app.md) |

```
apps/worker/
├── vitest.config.ts
├── src/
│   ├── main.ts                       ← the entrypoint; signals, boot, exit
│   ├── env.ts                        → Env      (the second of two process.env readers)
│   ├── import.ts                     ← the one outside surface
│   ├── bootstrap/
│   │   ├── index.ts
│   │   ├── worker-bootstrap.ts       → WorkerBootstrap
│   │   └── system-principal.ts       → SystemPrincipal
│   ├── consumer/
│   │   ├── index.ts
│   │   ├── analytics.consumer.ts     → AnalyticsConsumer   (project · reconcile)
│   │   ├── embedding.consumer.ts     → EmbeddingConsumer
│   │   ├── mail.consumer.ts          → MailConsumer        (send)
│   │   ├── outbox.consumer.ts        → OutboxConsumer      (drain · deliver)
│   │   └── maintenance.consumer.ts   → MaintenanceConsumer (sweep · partitions · archive)
│   ├── schedule/
│   │   ├── index.ts
│   │   ├── archive.schedule.ts       04:00 on the first
│   │   ├── cleanup.schedule.ts       03:00 daily
│   │   ├── outbox-drain.schedule.ts  every second
│   │   ├── partitions.schedule.ts    02:00 on the first
│   │   ├── projection.schedule.ts    every five minutes
│   │   └── reconcile.schedule.ts     05:00 daily
└── tests/
    ├── bootstrap/system-principal.spec.ts
    ├── consumer/mail.consumer.spec.ts
    ├── consumer/outbox.consumer.spec.ts
    └── consumer/maintenance.consumer.spec.ts
```

---

## What belongs here

A consumer, a schedule, or the wiring that starts them. Nothing else.

**What does not belong here.** A rule, a query, or a decision. If the logic would be identical when
invoked from an HTTP request, it belongs in a use-case and this app should be calling it —
`EmbeddingConsumer` is the shape: deserialise, build a principal, call `IndexDocumentUseCase`, and
let it throw.

The worker builds no adapter itself. It asks the container.

## `SystemPrincipal`: narrow, explicit, reviewed

**Every job carries an organization.** There is no global system principal, because there is no
global data — a job that processes rows must know whose rows.

The grant list is written out and reviewed. Never `PermissionRegistry.instance.all()`, and it is
validated at boot rather than at 3am, when the symptom would be a job that silently started failing
authorization after somebody renamed a permission.

The actor id is a fixed, reserved uuid rather than the organization's own: an actor column holding a
tenant id reads as a user.

## The three consumers and five schedules

See [`reference/consumers.md`](reference/consumers.md) and
[`reference/schedules.md`](reference/schedules.md).

## Reference

- [The consumers](reference/consumers.md) — why each is serial, why `handle()` is public, and why
  `EmbeddingConsumer` catches nothing.
- [The schedules](reference/schedules.md) — the fixed job ids that make registration idempotent, the
  clock order, and why none of them retries.
- [Subscribers](reference/subscribers.md) — the contract every outbox subscriber keeps, and why
  they live in `application` rather than beside the consumer that calls them.
- [Shutdown](reference/shutdown.md) — what `stop()` drains, the race that bounds it, and the order
  everything closes in.
- [`Env`](reference/env.md) — why the schema is smaller than the web app's and deliberately not
  shared with it.
