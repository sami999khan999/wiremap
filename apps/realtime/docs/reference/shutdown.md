---
title: Shutdown
description: Why a stop ends every stream cleanly at a random point in a window, rather than cutting them all at once.
---

# Shutdown

**The problem.** A deploy stops every replica of this process in turn. Each holds thousands of open
streams. Cut them all at once and every tab reconnects in the same second — each reconnect a full
principal resolution, a Postgres read and a replay of what the tab missed. The next
replica takes the whole herd at once.

**So a stop hands streams on rather than dropping them.** `RealtimeBootstrap.stop`:

1. Stops accepting — no new connections, idle ones closed.
2. Calls `RealtimeSubscriber.drain(budget / 2)`. Every open stream's deadline moves to a random
   point inside that window, and each ends **cleanly** there, the way it does at its maximum age.
3. Emits `realtime.stream.drained { streams, durationMs }` — `streams` is `-1` if the budget ran
   out first.
4. Waits, inside what is left of the budget, for the server to close: every drained stream still
   has its last frame to write, and a response that finishes leaves an idle socket, which is
   swept every 50 ms.
5. Cuts whatever is still open, disposes the container, emits `process.stopped`.

**Step 4 was found missing on Linux** (`CP7.5`). With the cut straight after the drain, the last
stream to drain lost its final frame 50 ms before it would have been written, and its client saw
`UND_ERR_SOCKET` rather than a clean end — so it backed off instead of reopening at once, on every
deploy. Measured in a `node:24` Linux container against the built process, five streams, the
default twenty-second budget:

| | streams ending cleanly | exit |
|---|---|---|
| before | 4 of 5; the last cut at 9 129 ms | 0 after 9.2 s |
| after, two runs | 5 of 5 | 0 after 10.1 s and 9.7 s |

The same run sent `SIGTERM` to the built web process: it exited 0 on its own after 6.0 s, which is
srvx's five-second window plus the second the container waits before it disposes.

A clean end is the part that matters. The browser's `RealtimeStream` reopens a stream that ended
cleanly within a second, with a `lastEventId`, and the next replica replays from the log both
share. Through the proxy that
reopen lands on another replica. A cut connection is an error instead, and the client backs off —
which is right for an outage and wrong for a deploy.

A second signal joins the stop already running. Redis refuses to reopen a connection once
`dispose()` has closed it, so a stream's `finally` running late cannot hold the process open.
