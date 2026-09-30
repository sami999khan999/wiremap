---
title: Realtime
description: One stream per tab, a total routing table, why every frame refetches rather than patches, how a burst is coalesced, and how a stream reopens — including the short replay and the resync past it.
---

# Realtime

`RealtimeProvider` opens one server-sent stream per tab and routes each frame to a cache
invalidation. That is the whole of the client half, and each of the three nouns in it is a decision.

## Refetch, never patch from a payload

A frame says *what changed*, not what it changed to. `RealtimeRoutes` maps an event name to the
query keys to refetch and nothing else. Lite has two names, `member.changed` and
`notification.created`. A frame's `payload` may carry ids that narrow **which** keys, never data to
render; the two routes today ignore it and refetch their whole namespace.

The alternative is tempting and wrong. A frame carrying enough to patch the cache carries a copy of
the server's shaping rules: which fields the list returns, how it sorts, what the DTO omits. That
copy drifts, and it drifts silently, because a patched cache looks right until the next refetch
replaces it with something different.

It also means a frame needs no permission check on arrival. The refetch it triggers goes through the
same procedure, the same `principalMiddleware` and the same permission as any other read, so a frame
about something you may not see produces a request that returns what you may see.

## A burst is two refetches, not twenty

`RealtimeRefetch` is single-flight per key with one trailing run, at least a second apart, and only
for queries a screen is showing. A busy tenant sends frames faster than a page loads; the first frame
refetches now, every frame that lands meanwhile collapses into one more refetch after it. One
instance per stream, disposed with it.

## The table is total, and the resync sweep is derived from it

`RouteTable` is `Record<RealtimeEventName, …>`, so a name added to `RealtimeContract` fails the build
here rather than arriving at runtime and doing nothing. `RealtimeRoutes.resync` walks the same table
rather than a second list, which is what stops the two drifting the first time somebody adds a route
and forgets the sweep.

**A `resync` refetches everything the table names, with no ids.** The frame carries no name —
that is the point of it: it means frames were lost, and any of them could have been any name.

## The replay is short, and the resync is what lies past it

A client that reconnects with `Last-Event-ID` is replayed the frames it missed, if the server's log
still holds the last one it saw — about two hundred frames per channel, kept for an hour
(`26.5`). Past that it gets a `resync` and refetches. The client does nothing different for either:
a replayed frame routes like a live one, and a `resync` walks the table. Saying so in the contract,
as a wire variant, is what keeps every reader honest — a transport that promised a full replay
would be a lie the first time a laptop lid closed overnight.

That is also why a frame is safe to lose. Everything the stream carries is an invalidation of
something the client can fetch, so the worst case of a dropped frame is data as stale as it would
have been with no stream at all.

## One stream per tab, opened in the layout

`RealtimeProvider` is mounted in the `_authenticated` layout, not in `__root`. It needs a session,
and a stream opened before there is one is a request that resolves to a 401 and retries forever.

**Not one per component.** On HTTP/1.1 a browser holds six connections per origin and a stream holds
one for as long as the tab is open, so two streams would leave four for everything else. A component
that wants the raw frame uses `useRealtimeEvent(name, handler)`, which listens to the one stream that
is already open.

**Not during SSR.** The effect returns early when there is no `window`. A stream opened on the server
holds a request open for the life of a render that has already finished.

## Reconnecting is `RealtimeStream`'s, not the retry plugin's

`ClientRetryPlugin` is on the link with **no default**, so `retry` is 0 for every call — a mutation
that retried itself would submit twice. The plugin only reconnects on a throw, and a stream that
reaches its maximum age ends **cleanly**, so a tab left open went silent after thirty minutes.

`RealtimeStream.run` is the reconnect loop the stream uses:

- **A clean end** — the server's maximum age, or its shutdown drain — reopens within a second,
  sending `lastEventId`, so the server replays what came after it, or answers `resync` when its log
  no longer reaches back. With no frame seen yet the id matches nothing, and a `resync` is right.
- **An error the catalog calls expected and not retryable** — signed out, forbidden, gone — stops.
  Asking again every few seconds gets the same answer and costs a principal resolution each time.
- **Anything else** backs off with full jitter, doubling from one second to thirty, never under
  thirty after `RATE_LIMITED`. A stream that stayed up a minute starts again from one second.

The jitter is the point. A deploy drops every tab at once; without it they all come back in the
same instant, which is a load test nobody scheduled.

A stream that cannot open is not a rendered error. `connected` goes false, the loop keeps trying,
and the tab keeps working on `staleTime`, which is exactly how it worked before any of this existed.

## The stream is held by its own process

The stream is a `realtime.*` procedure, and `ApiClient` sends that namespace to `/api/realtime`
— the stream process, `apps/realtime`, behind the web app's own origin. Nothing in this package
knows that: the provider calls `client.realtime.stream`, and where
the request goes is the transport's business. See `apps/realtime/docs/index.md`.
