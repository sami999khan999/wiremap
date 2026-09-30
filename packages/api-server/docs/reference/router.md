---
title: Router
description: The authed chain's order, why a stream is wrapped once for the shard scope and once for errors, and why every stream lives under one namespace.
---

# The router half

## `authed`, in order

`implement(contract)` with five middlewares, and the order is the design:

1. **Correlation** first, so a failure to resolve a principal is already correlated.
2. **Errors** second, so every failure after it — including the principal's — is logged once and
   leaves as the wire envelope, with a `traceId` and a request-scoped logger to hand.
3. **Principal** third. It fails **closed**: a procedure with no permission mapping is denied.
4. **Rate limit** fourth, because the count is per principal.
5. **Shard** last, because the key comes off the principal.

A router builds on `authed` and cannot forget any of them.

## The rate limit names its procedures

Until `CR.6` nothing on this surface was limited but the stream cap. `member.invite` and
`resendInvitation` could mail any address from the product's domain as fast as a script could call
them, and `document.search` and `document.index` are each a paid embedding call. The `docPage`
calls render Markdown or sign an upload. Better Auth limits
`/api/auth/*` and nothing else.

`RateLimitPolicy` lists the procedures that cost someone something, each with a limit and a window:

| Procedure | Limit |
|---|---|
| `member.invite`, `member.resendInvitation` | 30 an hour |
| `document.search` | 60 a minute |
| `document.index` | 30 a minute |
| `docPage.preview`, `docPage.search` | 120 a minute |
| `docPage.publish` | 30 a minute |
| `docPage.upload` | 60 an hour |

The count is per principal and procedure — `rate:<procedure>:<organization>:<user>` — in a fixed
window in the **cache** Redis, `SET NX EX` then `INCR` in one `MULTI`. Past the limit the call is a
`RATE_LIMITED`, a 429, and the catalog marks it retryable.

**There is no default for every other path**, deliberately. A limit on everything is a Redis round
trip on every request to protect procedures that cost nothing; this is one only on the eight that do.
A spec asserts every name in the policy is a real procedure, because a limit keyed on a renamed path
limits nothing and says nothing. **And the limit fails open**: a counter that cannot be reached lets
the call through, since a cache blip that refused every invitation is an outage the limit caused.

## A stream is wrapped twice

A streaming handler's body runs after `next()` has already resolved — the generator exists, and
nothing in it has run. So two things a unary call gets for free have to be carried frame by frame:

- **The shard scope.** `shardMiddleware` snapshots its `AsyncLocalStorage` inside the scope and
  calls every `next`, `return` and `throw` through it. Without that, every frame after the first
  runs with no key and a repository refuses to pick a pool.
- **The error envelope.** `errorMiddleware` wraps the same three methods so a throw mid-stream goes
  through `ErrorInterceptor` like a unary failure does.

## One namespace is one process

The stream is under `realtime`: `realtime.stream`, for the user's channel. That is what lets the
browser's client send every `realtime.*` path to the stream process and everything else to the web
app — a routing rule on the first path segment, with no list to keep in step.

## A stream asks again every minute

A stream is authorized when it opens and can then be held for thirty minutes. Until `CR.4` that was
the only check, so a member who was deactivated kept receiving frames until the stream aged out.

`StreamRevalidation.watch` asks again every sixty seconds. It gives the subscription a signal that
aborts with the request **or** the first time the check says no. The stream then ends normally; the
client reopens it, the open is refused, and a non-retryable refusal stops the client for good.

`realtime.stream` asks `memberships.isActive(user, organization)`.

**A platform suspend ends the stream the same way.** `memberships.isActive` joins `users` and
answers no once `suspended_at` is set, in every tenant at once, so the check needs no branch for
it.

**A check that throws keeps the stream.** Only a definite `false` ends it. A database blip that
ended every open stream would put every tab on the reconnect path at the same moment. A tick while
the last check is still out is skipped. The timer is `unref`'d and cleared in the handler's
`finally`, so a closed stream asks nothing more.
