---
title: The ports
description: One section per port whose reasoning outgrew a two-line comment — why three of them carry no Principal, why the analytics pair is split in two, and what each abstract method is refusing to offer.
---

# The ports

A port here is an abstract class the domain calls and `packages/infrastructure` implements. This
page carries the arguments; the port files themselves state constraints and stop.

## Three ports carry no `Principal`, and that is the design

`MaintenanceGateway`, `PartitionArchiveGateway`, `ActivityReplayReader` and `OutboxGateway` take no
actor on any method. That is not a hole in the authorization story.

Every *other* port reads or writes a tenant's rows, so `Authorizer.assert()` inside a use-case is
the gate. Nothing these three touch belongs to a tenant: **an expired session is expired for
everybody, and a partition is a property of a table rather than of an organization.** There is no
organization that could be asked to authorize either — which is exactly why
`SystemPrincipal.forOrganization` cannot express the work.

The guard is instead structural: nothing reachable from a request can call them. They are wired for
`apps/worker` and invoked only from a schedule.

### `MaintenanceGateway`

`sweepExpired` exists because `sessions` is bounded by expiry rather than partitioned — the trade
that table's own schema comment documents. This sweep is what makes that trade hold.

`ensureMonthlyPartitions` runs several months ahead on purpose. **A partitioned table with no
partition for the current date rejects every insert**, so the failure mode of running exactly one
month ahead is a total write outage at midnight on the first. It returns the partitions it created,
empty when they all already existed.

**The table is a `PartitionedTableName`, not a `string`, and that is not style.** Postgres accepts
no bind parameters in DDL — not for the table, not even for the range bounds — so the adapter builds
the statement by interpolation. A closed union from `PartitionedTable.ALL` is the only thing
standing between that and a table name arriving from somewhere else. The list is also what the
maintenance schedule loops, so a table partitioned by a later migration is covered by adding one
entry rather than by editing the worker.

`dropMonthlyPartitionsBefore` is the retention half, and it drops whole partitions rather than
issuing a `DELETE`: dropping a partition is a catalog edit, while deleting a month of rows leaves a
vacuum problem behind. It reads the children from the catalog instead of computing names from a date
range, because a month created by hand is still a partition and still has to be found — and it
leaves alone any child whose name it cannot parse, since this loop is holding a `drop table` and
"I could not read the name" is not evidence the rows are expendable.

### `PartitionArchiveGateway`

Cold storage for **every** partitioned table, which is what makes retention stop meaning deletion.
It is also the fourth prerequisite for adopting a derived analytics store, and the one the
deployment doc omits: without a writer for `partition_archive`, replay past the Postgres retention
window does not exist — which makes "no backups, because replay works" false rather than merely
optimistic.

**Detach, upload, record, verify, drop — in that order, and the order is the point.** Dropping
before verifying is unrecoverable loss. The unit is the tenant-month child, so `archive(table,
period)` runs that sequence once per tenant that held rows in the month. The period is an ISO
`YYYY-MM-DD` string naming the first of it: a third of the primary key of `partition_archive`, and
the same string a replay is asked for.

`restore()` is on the port for one reason: **an archive nobody has restored is a deletion with
extra steps.** It reads into a scratch table, never the live parent, because a re-attached month
puts archived rows back in the hot database and leaves the retention job arguing with itself.

`sweep()` is here because objects outlive the tenant by design — the index carries no foreign key
to `organizations`, so nothing cascades — and a GDPR-shaped hole created by cold storage is closed
by cold storage. The long form is
[`infrastructure/docs/reference/cold-storage.md`](../../../infrastructure/docs/reference/cold-storage.md).

### `ActivityReplayReader`

A separate port from `ActivityLogger` on purpose. `ActivityLogger` writes inside a transaction and
is reachable from every use-case; this reads in bulk, carries no `Principal`, and is reachable only
from the worker. **Merging them would put a cross-tenant scan on the port every use-case already
holds.**

`since()` is keyset pagination ordered by `(occurredAt, id)`, and returns fewer than `limit` rows
exactly when it has caught up — which is what the consumer stops on. The cursor carries both halves
or neither: **a cursor with only a timestamp cannot separate two rows written in the same
microsecond**, so it either drops one or replays it forever.

`ActivityRow` is deliberately not the domain event. A replay reads rows written long before the
current event definitions existed. `subjectId` is lifted out of the payload bag because the derived
store orders on it, and JSON extraction in an `ORDER BY` is what makes that slow.

## `ActivityLogger` stamps its own time

The port takes no `occurredAt` and no tenant: the adapter stamps the time from its injected `Clock`
and reads the organization off `actor`. **A caller that could pass its own timestamp is a caller
that can backdate an audit row.** `action` is a dotted past-tense string mirroring the permission
vocabulary — `task.reactivated`, `rbac.role.granted`.

## The analytics pair is two ports, not one

`AnalyticsProjector` is the write side of the derived store and **the only thing allowed to write to
it**. That restriction is the whole design: the moment a use-case writes there directly, or a
hand-run backfill invents a row, the store stops being rebuildable and has become a source of truth
nobody decided to create.

It has no read counterpart. One shipped — `AnalyticsReader`, with `goalRiskScores` and
`reliabilityTrend` over two rollup tables in each store — and nothing ever called it, so the port,
both implementations and the `ANALYTICS_DRIVER` flag that chose between them were deleted. When a
dashboard needs one it stays a **separate** port for the reason the split existed: a reader is
reachable from a request path and this is not, and a single port with both would put `project()` on
the object a dashboard query holds.

- `checkpoint()` reads where the last run stopped **from the derived store itself**, never from
  somewhere beside it. A checkpoint stored elsewhere can disagree with what actually landed, and the
  disagreement is silent; this cannot be wrong about its own rows.
- `project()` is idempotent by construction — rows are keyed on the activity id, so a redelivered
  batch overwrites rather than duplicates.
- `dailyCounts()` is the derived half of the daily reconciliation, in the same shape the
  authoritative half answers in, so the comparison is a diff rather than a query across two stores.
  The realistic failure it catches is not an outage: it is a consumer that died quietly on a Tuesday
  and was noticed a quarter later.

Days are ISO `YYYY-MM-DD` strings, not `Date`s, because Postgres `date_trunc` and ClickHouse
`toYYYYMM` return different shapes and each adapter normalises here. Two decisions carry over to a
future reader: it stays read-only by construction, since a write method makes a derived store
authoritative; and any permitted scope arrives as a resolved parameter, because an analytics store
has no `CapabilitySet` and no join back to goal membership, least of all a remote one.

## `ColdArchiveReader` has two methods for two callers, and one of them is a hole waiting

`batches(entry, size)` reads a whole tenant-month a batch at a time, verified against the recorded
checksum and count **before** the first batch is handed out. Its caller is the re-projection —
machinery, reading everything. It was `rows(entry)` until `CR.16`, which returned the month whole:
a large one OOMed the worker.

`page(entry, userId, cursor, limit)` is the user-facing one, and the `userId` is why it is
separate. **The object on disk holds the whole tenant.** There is no per-user object and no
server-side filter; the filter is a line in the adapter. So the rule
`ListNotificationsUseCase` already states — "there is no 'list someone else's': the permission
grants you *your* notifications, and a userId input would be the hole" — is not a convention here,
it is the only thing between one person and their colleagues' notifications. The use-case takes
the tenant and the user off the principal, and a spec asserts both.

The cursor is **opaque in the port** and a line ordinal inside the adapter, exactly as
`KeysetCursor` is opaque and a `(timestamp, id)` pair inside `PgNotificationRepository`. Two
cursor shapes, two encoders, neither known to the domain — widening one to cover both would make
both harder to read for no caller's benefit.

**The cost is stated rather than hidden:** every page turn reads and gunzips the whole
tenant-month to serve one user's slice. At the ~8 MB a four-thousand-user month sits at that is
fine; the plan names p95 over 500 ms as the trigger to give `notifications` a per-user object
layout under the same prefix.

## The three shard ports, and why there is no fourth

`ShardingStrategy.keyOf(principal)` decides **what** a request is placed by, `ShardResolver`
decides **where** that key lives, and `ShardAssignmentRepository` is the directory both read from.
Three responsibilities, three ports, and the split is not ceremony: the first is the fork's swap
point, the second is on the path of every routed query and therefore cached, and the third is a
platform seam with no principal — like `MaintenanceGateway`, and for the same reason.

There is no `ShardPlacementPolicy`. Choosing which node a *new* tenant lands on is a decision
nobody has to make while there is one node, and an interface with one implementation and no
prospect of a second is the thing `docs/opinions/simplicity.md` names. It earns its place at the
split, not before.

`keyOf` runs **once per request** in the middleware and once per job in a consumer, never per
query. A strategy called per query is one that has to be fast; called once, it can read whatever
it needs.

`resolve` returns a physical node index, not a virtual shard: decision D28 removed the level
between the organization and the node, so the organization *is* the shard. A key with no
directory row resolves to node 0, which is exactly what an unsharded deployment is — so the
directory being empty is a working state rather than a broken one.

## `LogReader` and the four labels

`LogFilter` is closed on purpose. **The four labels are the only fields the log platform indexes**;
everything else lives in the line body and is filtered after the selector has narrowed the streams.
A `userId` promoted to a label creates one stream per user and is the single most common way a Loki
deployment falls over — so the port does not offer the shape. `contains` is matched against the line
body, and is where a trace id, a correlation id or an organization id belongs.

The port is read-only and deliberately not on the write path: `JsonLogger` writes to stdout and has
never heard of a log platform, which is what keeps it a Tier 0 dependency and the platform swap a
config change. It exists for the operator surface — **the one reader that knows what an organization
is**, which is the one thing a generic log console cannot know. It is absent from a container built
without a log platform configured, because a reader that silently returns nothing is worse than one
that is honestly not there.

## `EmailSender` has exactly one method

No provider, no credentials, no from-address — those are adapter configuration, the same way a
bucket and a region are absent from `StorageGateway`.

**One method, because the system sends transactional messages and nothing else.** A campaign, a
template registry or a suppression list is a different product with a different port; adding them
here would make every adapter owe an implementation of features the domain never asks for.

Plain text is required and HTML is not. Every client renders text, a text part is what keeps a
message out of a spam folder, and a transactional email whose whole content is a link does not need
a layout to be readable.

`send()` resolves when the transport has **accepted** the message, which is not delivery and never
can be. A caller that needs delivery confirmation is asking a question only a webhook from the
provider can answer.

It resolves with an `EmailReceipt` carrying the transport's `messageId`, nullable because plenty of
servers return none. **The receipt is logged, not stored** — this system keeps no delivery table, so
the id exists to be correlated later against a provider's own record. Every hop to it is optional
for a reason worth keeping: reading the id off a transport that resolved with nothing turned a sent
message into a thrown `UnavailableError` and a pointless retry.

## `DomainEventPublisher` is broker-shaped before there is a broker

Four properties, and they are chosen because they are the four a real broker cannot give back later
([Data and scale](../../../../docs/opinions/data-and-scale.md) §7):

- **`publish` returns nothing.** A caller reading a return value is doing RPC, and the day this sits
  behind Kafka there is nothing to return.
- **Handlers are idempotent on a stable event id.** At-least-once is what every broker offers, so a
  duplicate has to be a no-op rather than a second effect.
- **No ordering.** Two events published in order may be handled out of order.
- **No handler exception reaches the publisher.** In-process dispatch *could* propagate one; a broker
  cannot, so a use-case that caught a handler failure would depend on semantics that disappear.

**Call it inside `unitOfWork.run`.** That is the whole point of an outbox: the row and the state
change that caused it commit together or not at all. Publishing to a broker inside a transaction
cannot be rolled back, and publishing after the commit loses the event on a crash in between. An
outbox table written in the same transaction is the only shape with neither hole, and `BaseRepository`
already joins the ambient transaction — `PgActivityLogger` is the worked example.

The audit row and the outbox row sit side by side in the same `run`, and they are not the same thing:
**audit is the human fact, the outbox is the integration fact.** One has a retention policy and a
reader in the UI; the other has a schema, a `published_at`, and subscribers.

## `OutboxGateway` hands out claimed work, and marks it only on success

`drain(limit, relay)` claims a batch, calls `relay`, and marks the rows published **only if `relay`
resolves**. A throw releases the claim and the same rows come round on the next tick. That is what
makes the whole pipeline at-least-once rather than at-most-once, and it is why the in-memory fake
honours the same ordering — a fake that removed rows first would let a spec prove a guarantee the
adapter does not have.

**No transaction is open across the relay.** The claim is one auto-committed statement — `FOR UPDATE
SKIP LOCKED` inside an `UPDATE` that stamps `claimed_until` sixty seconds out — so two worker
replicas still share the drain with no coordinator, and the relay's Redis round trips hold no row
lock and no snapshot. It used to run inside one transaction, which held the node's xmin for the
whole batch every second, and a slow queue Redis stalled vacuum node-wide. A drain that dies
between relay and mark frees its rows when the lease passes; the relayed jobs dedupe by id.

`oldestPendingAt()` returns `null` when nothing is pending. That is the *healthy* answer, not a
missing one, and an alert keyed on lag has to treat the two differently.

**The inbox table is deliberately deferred.** A crash between relay and mark re-publishes the same
job ids, and BullMQ drops the duplicates while they are still on the queue; anything older is caught
by the subscribers' own idempotency, which is a stated requirement rather than a hope. The trigger
for adding a `processed_event` table is written down: **the first subscriber whose effect is not
idempotent by construction.**

## `EventSubscriber` receives the event, never an actor

A subscriber that needs a principal builds one from `event.organizationId`. Handing it the original
actor would be handing it a permission set that was resolved at request time and may since have
changed — and the work is not being done on that person's behalf anyway.

Subscribers live **in `application`, in the slice they serve**, not in a folder of their own next to
the consumer. `notification/notification.subscriber.ts` is a notification concern that happens to be
triggered by an event; putting it beside the queue binding would file it by mechanism.

They run **only in the worker**, because `SubscriberRegistry` is consulted only by `OutboxConsumer`.
A subscriber invoked in the web tier would be the in-process dispatch §7 forbids depending on.

`SubscriberRegistry` rejects a duplicate name or an unknown event **at construction**, which makes a
wiring mistake a startup crash rather than an event lost at 3am. The name matters because it is half
of every job id: two subscribers sharing one would deduplicate against each other, and one of them
would silently never run.

## `RealtimePublisher` is fire-and-forget, and says so

A frame published to a channel nobody is listening on is kept only as long as the adapter's
replay log keeps it — the last two hundred per channel, for an hour (`26.5`). A resume inside that
is replayed what it missed; one outside it is handed a `resync` and refetches what it subscribes
to. The `resync` variant stays in the contract because the log is short by design, and a contract
that promised a full replay would be a lie the first time a tab slept for a day.

Channels are **tenant-leading, always**: `org:<organizationId>:user:<userId>`. Sharded pub/sub
(`SPUBLISH`), Redis Streams and a broker partitioner can all key on a prefix, and none of them can
key on something buried in the middle. `RealtimeChannel` is a branded string so a channel cannot be
assembled by concatenation at a call site, which is how one ends up without its prefix.

A user channel is **authorised by construction**: you only ever receive your own, so the stream needs
no per-frame permission check.

## `RealtimeSubscriber` takes a signal because the domain has no `AbortSignal`

`subscribe(channels, signal)` returns an `AsyncIterable` that ends when the signal aborts or the
adapter's maximum stream age elapses, and never buffers history. Breaking out of a `for await`
would end it too — an async generator's `finally` runs on `return()` — but a signal is what lets
something *other than the reader* end it: a shutdown, a stream that has been open too long, a cap
on how many one person may hold.

The signal's type is `CancellationSignal`, three members wide, declared in `primitive/`. It is not
`AbortSignal`: `lib` here is `["ES2024"]` and nothing else, so there is no such name, and reaching
one by adding `DOM` would put every browser global inside the domain. A real `AbortSignal`
satisfies it structurally, so no adapter or router wraps anything.

**The two fakes are deliberately not connected by default.** `TestContainer` builds a
`RecordingRealtimePublisher` that records and an `InMemoryRealtimeSubscriber` over a hub of its
own, because most specs only ask what was published. A spec asserting that a frame *arrived*
builds one `InMemoryRealtimeHub` and passes both fakes over it — which is also the only way to
write the assertion that matters, that the frame reached this user's channel and no other.

One name collision worth knowing before you grep: `RealtimeSubscriber` is this port, and
`MemberRealtimeSubscriber` is an `EventSubscriber` — a reaction to a committed domain event that
happens to publish a realtime frame. Neither name is wrong in its own vocabulary and nothing
compiles the two together, but they are different kinds of thing.

## `MailPublisher` returns nothing, and `MailRenderer` knows no transport

These two are the mail pipeline's whole seam, and the split between them is the point:
`MailPublisher` is what a caller holds, `MailRenderer` is what the worker holds, and neither knows
the other exists.

**`publish` resolves with `void`.** There is no delivery row, so an id handed back would be a
handle to a record that does not exist — and a caller that held one would eventually try to read
it. What a caller *can* pass is a `dedupeKey`, which becomes the BullMQ job id: "send this once"
belongs where the queue already enforces it, not in a table a second process has to check.

**The request carries the recipient's locale, not the request's.** Mail is read long after the click
that caused it, in whatever language that person set — which is why `users.locale` exists and why
composing per recipient is a `Translator.with()` call rather than a second system.

`priority` is `"high" | "normal"` rather than a number. A caller choosing 37 is choosing against
every other caller, and the only distinction that has ever mattered here is whether somebody is
sitting and waiting for the message.

**`MailRenderer` returns both parts, always.** Text is what every client renders and what keeps a
message out of a spam folder; HTML is what makes the action look like a button. Returning one and
leaving the other optional is how a pipeline ends up shipping text-only mail nobody noticed.

The renderer is a port rather than a function in the worker because `application` may know neither
the words nor the routes: the copy catalog carrying them is server-only, and the layer that holds
both is `composition`.

## `SendMailUseCase` asserts nothing, and that is the design

It is the only use-case in this package that never calls `authorizer.assert`. Mail belongs to no
tenant — every message Better Auth sends has no organization, and an invitation goes to somebody
who does not have an account yet — so there is no organization that could be asked to authorize it.
`SystemPrincipal.forOrganization` cannot express the work, exactly as it cannot for the three
gateways above.

The guard is the same structural one: nothing reachable from a request can call it. It is wired for
`apps/worker` and invoked only from the mail consumer.

What it *does* enforce is the manifest. A job crosses the queue as JSON, so the template key is a
string and the params are `unknown` by the time the worker sees them. Both are checked before the
transport is touched, because a message that cannot be built will not build on the retry either.

## `StorageGateway`

No bucket, no region, no endpoint. Key layout is `<subject>/<yyyy>/<mm>/<uuid>.<ext>`, because
lifecycle rules work on prefixes.

`putStream` is the same write for a body that must not be held in memory. An archived `activity_log`
partition is tens of gigabytes at the scale this system plans for, so `put` cannot serve it — and
buffering would fail only once the data is large enough that failing is expensive. The checksum on
`StoredObject` is computed over the stream as it passes, which is what lets the archive be verified
afterwards.

The presign methods are in the port because "the browser uploads directly and the server never sees
the bytes" is an architectural choice, not an implementation detail: the use-case authorizes, then
issues the URL. Both are time-limited, never a permanent public URL.

## `SessionResolver` and why the session carries its tenant

`RequestHeaders` is structurally satisfied by a Web `Headers`, so `resolve(request.headers)` just
works. It is declared rather than named because `lib: ["ES2024"]` has no `Headers`, and adding
`@types/node` to borrow one method would put Node's globals in a runtime-neutral package.

The session carries its organization because `PrincipalBuilder` is handed headers and nothing else,
and a `Principal` cannot be built without a tenant. Resolving it per request instead would be a
membership query on every call; pinning it at sign-in is one column. A user in two organizations
gets two sessions — which is also what makes switching organizations an explicit act rather than an
ambient one.

## The small ones

| Port | The decision |
|---|---|
| `CacheStore.deletePrefix` | Invalidating a whole subject belongs here rather than at the call site: enumerating keys by hand pushes Redis semantics into the domain |
| `CacheStore.setIfAbsent` | Returns whether it wrote, which is what makes it an idempotency claim rather than a write. One `SET … EX … NX`, evaluated on the server, so two replicas racing a key cannot both be told they won it. The send dedupe is its first caller — see [messaging](https://github.com/prodicle/loadbearing_tanstack_start_kit/blob/3fafa78c2f42d2d718236d7666429b858199118a/packages/application/docs/reference/messaging.md) |
| `EmbeddingProvider.embed` | Batched by construction — one round trip per call, never one per text. A single-string signature is the shape that turns a re-index into a thousand requests |
| `QueuePublisher` | The deduplication id is a domain rule ("enqueue OCR for this receipt, once"), not queue configuration |
| `UnitOfWork` | The implementation must genuinely enrol the repositories running inside `work()`; one that does not is worse than none |
| `VectorStore.search` | `goalIds` is required so the permission filter runs on the **input** set. Filtering results means the model already saw what the actor cannot |
