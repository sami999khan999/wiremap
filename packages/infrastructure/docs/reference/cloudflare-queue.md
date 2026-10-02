---
title: Cloudflare queue
description: CloudflareQueuePublisher and JobSignatureHasher — how a job reaches Cloudflare Queues through the dispatcher Worker and comes back to the web app, and what changes from BullMQ.
---

# Cloudflare queue

`QUEUE_DRIVER=cloudflare` swaps `BullMqQueuePublisher` for `CloudflareQueuePublisher`. The use-cases
do not change: they still call `QueuePublisher.publish`.

## The round trip

```
use-case ──publish──▶ CloudflareQueuePublisher ──POST /enqueue (signed)──▶ dispatcher Worker
                                                                              │ JOBS.sendBatch
                                                                              ▼
web app /api/internal/job ◀──POST (signed), one message──── Cloudflare Queues consumer
        │
        └─▶ ConsumerRegistry.run(queue, job) ── the same consumer the BullMQ worker runs
```

1. The publisher sends up to 100 messages per request to `<DISPATCHER_URL>/enqueue`.
2. The Worker checks the signature and puts them on the `wiremap-jobs` queue.
3. The Worker's queue consumer posts each message to `<WEB_URL>/api/internal/job`.
4. The web app checks that signature and runs the consumer. A 2xx acknowledges the message;
   anything else is retried.

## Signatures

Both hops use one scheme, `JobSignatureHasher`:

| Header | Value |
|---|---|
| `x-wiremap-timestamp` | milliseconds since the epoch |
| `x-wiremap-signature` | `v1=` + hex HMAC-SHA256 of `<timestamp>.<body>` |

A request more than five minutes from the receiver's clock is refused, which is what makes a
captured request useless later. The hop into the Worker uses `DISPATCHER_SECRET`, and the hop back
uses `INTERNAL_JOB_SECRET`. The Worker re-implements the same scheme over WebCrypto, and a spec in
`apps/dispatcher` checks the two produce identical signatures.

## What changes from BullMQ

| `JobOptions` | BullMQ | Cloudflare |
|---|---|---|
| `attempts` | BullMQ retries | carried as `maxAttempts`; the Worker retries, then sends the message to `wiremap-jobs-dead` |
| `delayMs` | exact | rounded up to whole seconds, capped at 12 hours |
| `jobId` | one job per id while it is kept | claimed in the cache for `removeOnCompleteAgeSeconds`, else 24 hours |
| `inFlightId` | one while waiting or running | claimed for 10 minutes: Cloudflare cannot report when a job finishes |
| `onceWithin` | exact | claimed in the cache for its `seconds` |
| `priority` | ordered within a queue | **ignored**: a queue stays the priority boundary |

A claim is released when the dispatcher refuses the request, so the caller's retry is not
swallowed by its own first attempt.

Retries back off from 5 seconds, doubling, capped at an hour. The free plan allows 10,000 queue
operations a day, and each message costs about three (write, read, acknowledge). See
[`docs/infra/free-tier.md`](../../../../docs/infra/free-tier.md).

## Draining the outbox

BullMQ drains `outbox_event` every second on a schedule. Cloudflare has no schedule that frequent,
so under this driver the container wraps the outbox publisher in `OutboxDrainPublisher`. Every
event write queues one `EVENT/drain` five seconds later, deduplicated per five-second window. The
dispatcher's hourly cron is the backstop for a drain request that was lost.
