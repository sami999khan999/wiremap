---
title: correlation
description: One id per request, adopted from upstream where there is one, stamped onto the error envelope so a user can read it back.
---

# `Correlation`

```ts
export type TraceId = string;

export class Correlation {
  public static readonly HEADER = "x-request-id";
  public static sanitise(value: string | null | undefined): TraceId | null;
  public static mint(): TraceId;
  public static fromHeaders(headers: { get(name: string): string | null }): TraceId;
}
```

---

## Adopt upstream's id before minting your own

```ts
const traceId = Correlation.fromHeaders(request.headers);
```

A load balancer, CDN, or reverse proxy in front of the app usually sets `x-request-id` already.
Adopting theirs is what makes their access log and this stream one trace rather than two you
correlate by timestamp at 3am.

Minting only happens when there is nothing to adopt.

## An adopted id is untrusted input

It arrives from the network and then rides **every line** of the request. So it is bounded to 128
characters and character-checked against `[\w.:-]+` before it is trusted; anything else is discarded
and a fresh id minted.

Without that, a caller controls a string that appears in every log line, which is a log-injection
primitive and an unbounded field on a per-request basis.

**The rule itself lives in `TraceIds`, in `@loadbearing/errors`, and `sanitise` delegates to it.**
The request header is not the only door: `AppError.from()` rebuilds a trace id out of an envelope
that arrived over the same network, and for a while adopted it verbatim. One rule in two packages is
the pair that drifts, and the dependency direction settles which one holds it — `observability`
imports `errors`, never the reverse.

**Unbounded per request is also why `traceId` must never become a log label.** A label in a log store
like Loki creates one stream per distinct value, so labelling the trace id means one stream per
request. It stays in the body and is reached with `| json | traceId="…"` after the selector has narrowed the streams. The
legal label set is `app`, `env`, `level`, `event_code` and nothing else — see
[Data and scale](../../../../docs/opinions/data-and-scale.md).

```ts
Correlation.sanitise("a b c");      // null — mint instead
Correlation.sanitise("<script>");   // null
Correlation.sanitise("a".repeat(500)).length;  // 128
```

## A plain string, not a branded id

`contracts` explicitly refuses to own "a UUID that is genuinely just a UUID (a request id, a trace
id)", and it is right: branding exists to stop a `GoalId` being passed where a `TaskId` belongs, and
there is no second trace-shaped thing to confuse this with. It also has to survive arriving from a
proxy in whatever shape that proxy chose.

Minting uses `Uuid.v7()` from `core`, so a trace id sorts by time like every other id in the repo.

## Where it is created

| Runtime | Where | Why there |
| --- | --- | --- |
| `apps/web` | a middleware **before** `principalMiddleware` | both entrypoints already pass raw `Headers`; nothing upstream changes |
| `apps/worker` | per job, next to `SystemPrincipal.forOrganization(...)` | the worker never runs oRPC middleware |

In both cases the id is bound onto a child logger immediately, so every subsequent line carries it
without any call site naming it again.

## It reaches the user

`ErrorEnvelope.traceId` was declared from the beginning and left unpopulated. The error interceptor
stamps it on the way out, `AppError.from()` reads it back on the way in, and `TransportError` keeps
it — so an error page can show a reference string.

That closes the loop that makes the whole thing worth building: a user says "it broke at about two",
hands over eight characters, and the exact line comes back. Without it you are searching a timestamp
range across every request the system served.

> [!NOTE]
> A server-*thrown* error carries no trace id of its own, and `ForbiddenError` will never grow one.
> The id belongs to the request, not to the failure — the adapter that knows about requests is the
> one that stamps it.

## What is not here yet

**Propagation across the queue.** A request that enqueues a job, and the worker that runs it, are
currently two traces. Joining them needs either a `traceId` on `JobOptions` — which puts a
diagnostic concern into a domain port — or `AsyncLocalStorage`, which is Node-only and cannot live
in an isomorphic package. Worth deciding once the worker has real jobs.
