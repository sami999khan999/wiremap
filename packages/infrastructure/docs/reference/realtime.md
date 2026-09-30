---
title: Realtime
description: One subscriber connection per process, ref-counted channels, a bounded queue whose overflow is a resync rather than a dropped frame nobody hears about, and the short log a resume is replayed from.
---

# Realtime

Two adapters over Redis pub/sub, both on the **realtime** role — the cache instance unless
`REDIS_REALTIME_URL` sets a third one apart. Pub/sub is fire-and-forget, so the queue instance's
durability guarantee buys nothing here and its `noeviction` policy is wasted on traffic that is
gone the moment it is delivered. When to split it out is in `docs/infra/reference/redis.md`.

## One connection per process, not one per stream

A connection that has run `SUBSCRIBE` can run almost nothing else — ioredis enforces this, and so
does Redis. That is why `"subscriber"` is a third `RedisRole` rather than a second use of
`client()`, and why `RedisRealtimeSubscriber` demultiplexes: every open stream in the process
shares one socket, and the `message` handler routes each frame by channel to the sinks registered
on it.

The alternative is one connection per open tab. That is the number that takes a Redis down rather
than a replica, and it is invisible until the connection count is the symptom.

The role is created on first use, like every other, so a process that never opens a stream never
opens the connection. `RedisConnection.opened(role)` answers whether one exists **without
creating it**, which is what lets the health report say `null` for the worker rather than opening
a subscriber connection in order to report on it. `PING` is one of the eight commands valid in
subscriber mode, so `healthy("subscriber")` reports on the connection the streams are actually on
rather than on a second one nothing uses.

**It answers `["pong", ""]` there, not `"PONG"`.** A connection in subscriber mode replies to
`PING` with a two-element push message, so an equality test against the simple string reports the
one connection this check exists for as *unhealthy* — and, because the roll-up treats `false` as a
failure, reports the whole web process as unhealthy for as long as anyone has a stream open. The
smoke case has to assert it **while the stream is open**: the generator unsubscribes on the way
out, and a connection that has left subscriber mode answers `"PONG"` again and passes either way.

**It carries the cache client's key prefix, deliberately.** Neither `PUBLISH` nor `SUBSCRIBE`
declares a key, so the prefix reaches no channel name today — the two sides would agree with or
without it. `SPUBLISH` and `SSUBSCRIBE` *do* declare keys. Matching the prefix now is what keeps a
later move to sharded pub/sub symmetric instead of silently delivering to a channel nobody is on.

## Channels are ref-counted, and the last reader releases them

Two tabs on one user channel are one `SUBSCRIBE`. The first to leave releases nothing; the last
one out sends the `UNSUBSCRIBE`. A channel left subscribed costs a frame delivered to nobody on
every publish for the life of the process, and nothing about it looks wrong from outside.

## The queue is bounded and the overflow is honest

Each stream has its own queue — 256 by default. On overflow the **oldest** frame is dropped and
the reader is handed a `resync` before anything else. Two halves are load-bearing:

- **Oldest, not newest.** The newest frame is the one the reader has not seen. The lost ones cost
  a refetch either way, and dropping the arriving frame would mean a reader that is behind stays
  behind forever.
- **A `resync` rather than silence.** A reader this far behind is past what any replay would
  hand it in time, so a gap the client is not told about is a screen that is quietly wrong. A
  slow tab costs a refetch; it must never cost the process memory.

## A resume is replayed from a short log (`26.5`)

The publisher writes every `event` frame twice, in one `MULTI`: `XADD` to the channel's log —
`realtime:log:<channel>` behind the client's key prefix (`app:realtime:log:…` on the wire; ioredis
prefixes keys and never pub/sub channels), a Redis Stream trimmed to about two hundred entries
and expiring an hour after its last write — then `PUBLISH`. Logged first, so a frame a client has seen is always a
frame the log holds. Typing frames are neither logged nor given an SSE id, so they are never the
point a client resumes from.

On a resume the router passes `lastEventId` as `after`. The subscriber attaches to the channel
**first**, so nothing published while it reads is lost, then reads the log with `XRANGE` on a
client that is not in subscriber mode, finds `after`, and queues everything past it ahead of what
it has heard live — dropping from the live queue any frame the log already carried. When `after`
is not in the log, because it was trimmed or expired or the frame was never logged, the reader is
handed a `resync` instead, as every resume was before. A stream over more than one channel always
resyncs: two logs share no order that one `lastEventId` could name.

**The cost** is one `XADD` and one `EXPIRE` beside each `PUBLISH`, in the same round trip, and
about two hundred frames of memory per active channel on the realtime Redis. A log is rebuildable
state in the sense `data.md` means: losing it costs a refetch and nothing else.

## The cap counts user channels only

`maxStreamsPerUser` counts concurrent streams per **user** channel, which `RealtimeChannels.isUser`
identifies. A conversation channel is one channel with many readers, and counting it the same way
would cap the room rather than the person — a cap that gets stricter the more popular the
conversation is.

It is a per-process count, not a per-cluster one. A shared counter would cost a round trip on
every stream open, and the failure this exists to prevent is one runaway tab, which is local by
construction.

## The maximum age is spread

Each stream's deadline is `maxAgeMs × (0.9 + 0.2 × random)`. Tabs opened in the same second — every
tab after a deploy — would otherwise all end in the same second thirty minutes later and all reopen
together. Ending is not an error: the client's `RealtimeStream` reopens a stream that ended cleanly.

## Every frame is parsed, not cast

`at` crosses the wire as a string, and the contract coerces it. A reader handed the raw JSON would
hold a value typed `Date` that is not one, and the failure surfaces wherever it is first compared
rather than where it was made. A frame that does not parse is dropped and the stream continues:
the bus is shared, and one malformed publish must not end everybody's stream.

## What the specs cover, and where

`tests/redis/redis-realtime.subscriber.spec.ts` drives all of the above against a fake client —
demux, coercion, the dropped frame, the overflow `resync`, ref counting, the cap, the non-user
channel, and the maximum age. Those are branches, and a live instance would prove only that
ioredis accepts the arguments.

`tests/smoke/redis.smoke.spec.ts` covers the one thing no fake can: that the publisher's channel
string and the subscriber's are the same string after ioredis has finished with both, and that
`PING` answers on a connection in subscriber mode.
