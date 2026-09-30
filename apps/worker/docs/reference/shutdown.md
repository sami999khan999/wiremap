---
title: Shutdown
description: What stop() drains, the race that bounds it, the order everything closes in, and why a second signal joins the drain instead of ending it.
---

# Shutdown

```
SIGTERM → stop(signal) → workers close (bounded) → redis close → container.dispose() → exit 0
```

## `close()` drains; the race bounds it

`Worker.close()` waits for in-flight jobs to finish, which is the whole point: a job killed
mid-flight is work that has to be redelivered and redone.

The race against `WORKER_SHUTDOWN_TIMEOUT_MS` is the backstop. **A job that never returns must not
hold the process past the platform's SIGKILL timer** — a value above that timer just means the
platform kills you mid-drain, which is worse than draining what you can.

The timeout promise's timer is `unref()`ed, so a pending timer cannot be the thing keeping the event
loop alive once every worker has already drained.

## The close order

1. **Workers**, so nothing new is accepted and in-flight work finishes.
2. **Redis**, once nothing is consuming.
3. **`container.dispose()` last**, because everything closing above it may have had something to say.
   See
   [`composition/docs/reference/container.md`](../../../../packages/composition/docs/reference/container.md)
   for why `dispose()` itself closes in reverse construction order.

## `stop()` is idempotent, and the second caller *joins*

A SIGINT arriving during a SIGTERM drain must not close everything twice, which surfaces as an
unhandled rejection from an already-closed client. `stop()` memoises the drain in `draining` and
returns it, so the second call awaits the same work.

> [!IMPORTANT]
> **Returning the promise is half the guard, not a refinement of it.** A guard that returns nothing
> still prevents the double close — and hands the second caller a promise that is already resolved.
> `main.ts` chains `.then(() => process.exit(0))` onto whatever `stop()` returns, so the second
> signal exits the process **mid-close**: workers still draining, Redis still open, no
> `process.stopped` line. `??=` is what makes the two callers share one drain.

> [!NOTE]
> **A `close()` that rejects after the backstop is logged, not fatal.** The rejection handler is
> attached to the `Promise.all` *before* the race, because once the timeout has won the drain moves
> on and a late rejection has nowhere to land but `unhandledRejection` — which exits 1 over a
> shutdown that had already succeeded.

## The worker's own Redis connection

`main.ts` builds its own `RedisConnection` rather than reaching for the container's. That keeps
`Container.redis` private and gives consuming and publishing independent connections.

> [!CAUTION]
> It must be a `RedisConnection`, not a bare `{ host, port }`. That class is what applies
> `maxRetriesPerRequest: null`, without which BullMQ's blocking commands hit ioredis's default retry
> limit and **the worker stops consuming with no error at all.**

## The signal and failure handlers

`unhandledRejection` and `uncaughtException` are registered **before** `start()`, so a throw during
boot lands in the same log stream as a throw during work. Node's default handler prints a bare stack
to stderr, which no collector can key on.

The shutdown `.catch` logs rather than swallowing, for the same reason: a bare
`.catch(() => process.exit(1))` turns every shutdown failure into an exit code, which is unreadable
in a container log.

The signal handlers are registered against the `start()` promise rather than after awaiting it, so a
signal arriving **during** boot drains rather than getting Node's default handling on a worker with
consumers running and schedules half registered. The handler waits on that promise before calling
`stop()`: there is nothing to drain until the consumers exist.

**That wait is bounded at five seconds.** `start()` blocks on an unreachable queue Redis, and a
handler that simply chained off the promise did nothing at all in that state — the signal was
accepted, no shutdown ran, and the orchestrator's grace period ended in a SIGKILL. When the deadline
wins the race the worker logs a failure and exits non-zero rather than draining, because nothing was
registered and `close()` on a worker that never started is not the same as a drain.

Top-level `await` works here because the package is ESM and the tsconfig targets ES2024 under
NodeNext resolution.

## What `consumers` on the stopped line means

`WorkerBootstrap` reports `consumers: this.workers.length`. The projection consumer is counted when
it started and absent when it did not, which is **the only difference on the wire** between a worker
running the analytics pipeline and one built without a store to project into.
