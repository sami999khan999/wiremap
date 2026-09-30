---
title: The ports
description: One section per port whose reasoning outgrew a two-line comment — why three of them carry no Principal, and what each abstract method is refusing to offer.
---

# The ports

A port here is an abstract class the domain calls and `packages/infrastructure` implements. This
page carries the arguments; the port files themselves state constraints and stop.

## Three ports carry no `Principal`, and that is the design

`MaintenanceGateway`, `PartitionArchiveGateway` and `OutboxGateway` take no actor on any method. That is not a hole in the authorization story.

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
empty when they all already existed. `ensureMonthlyPartitionsFor` does the same for a page of
tenants in one read and one transaction, and `monthlyPartitionsAfter` is the runway check: it asks
what *exists*, because a run that created nothing is healthy or starved alike.

**The table is a `PartitionedTableName`, not a `string`, and that is not style.** Postgres accepts
no bind parameters in DDL — not for the table, not even for the range bounds — so the adapter builds
the statement by interpolation. A closed union from `PartitionedTable.ALL` is the only thing
standing between that and a table name arriving from somewhere else. The list is also what the
maintenance schedule loops, so a table partitioned by a later migration is covered by adding one
entry rather than by editing the worker.

**There is no method that drops a month.** Lite keeps every partition. The one drop is
`dropTenantPartitions`, the whole tenant level for one organization, which only a tenant delete
calls. `partitionsBefore` lists the months that delete archives first. Dropping months by age comes
back with its archive — see [`docs/scale/retention.md`](../../../../docs/scale/retention.md).

### `PartitionArchiveGateway`

Cold storage for a deleted tenant's rows, and the tenant export. Lite archives only on a delete,
so the delete is recoverable for as long as the sweep waits.

**Detach, upload, record, verify, drop — in that order, and the order is the point.** Dropping
before verifying is unrecoverable loss. The unit is the tenant-month child, so `archive(table,
period, organizationId)` runs that sequence once per tenant-month. The recorded period is an ISO
`YYYY-MM-DD` string naming the first of the month, a third of the primary key of
`partition_archive`.

`markTenantDeleted` stamps the tombstone the recovery window is measured from, and
`sweepDeleted(before)` forgets every tenant deleted before it. `sweep()` removes one tenant's
objects, then its rows: a crash leaves a row pointing at a deleted object, which is re-runnable.
Objects outlive the tenant by design — the index carries no foreign key to `organizations`, so
nothing cascades — and a GDPR-shaped hole created by cold storage is closed by cold storage.

`exportTenant` reads live rows and never detaches: an export must not take the tenant's data
offline while it runs. The long form is
[`infrastructure/docs/reference/cold-storage.md`](../../../infrastructure/docs/reference/cold-storage.md).

## `ActivityLogger` stamps its own time

The port takes no `occurredAt` and no tenant: the adapter stamps the time from its injected `Clock`
and reads the organization off `actor`. **A caller that could pass its own timestamp is a caller
that can backdate an audit row.** `action` is a dotted past-tense string mirroring the permission
vocabulary — `task.reactivated`, `rbac.role.granted`.

## The two shard ports, and why there is no third

`ShardingStrategy.keyOf(principal)` decides **what** a request is placed by, and `ShardResolver`
decides **where** that key lives. Two responsibilities, two ports, and the split is not ceremony:
the first is the fork's swap point, and the second is on the path of every routed query and
therefore cached. The directory both read is the catalog table `shard_assignments`, written by the
founder when a tenant is created.

There is no `ShardPlacementPolicy`. Choosing which node a *new* tenant lands on is a decision
nobody has to make while there is one node, and an interface with one implementation and no
prospect of a second is the thing `docs/opinions/simplicity.md` names. It earns its place at the
split, not before.

`keyOf` runs **once per request** in the middleware and once per job in a consumer, never per
query. A strategy called per query is one that has to be fast; called once, it can read whatever
it needs.

`resolve` returns a physical node index, not a virtual shard: decision D28 removed the level
between the organization and the node, so the organization *is* the shard. `placementOf` returns
the node and whether the tenant is frozen, in one cache entry, because `PgUnitOfWork.run` reads the
freeze on every write. A key with no directory row is refused: `PgShardResolver` emits
`shard.resolution.failed` and throws, since guessing node 0 would be wrong the day after a split.

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
**audit is the human fact, the outbox is the integration fact.** One has a reader in the UI; the other has a schema, a `published_at`, and subscribers.

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
| `CacheStore.setIfAbsent` | Returns whether it wrote, which is what makes it an idempotency claim rather than a write. One `SET … EX … NX`, evaluated on the server, so two replicas racing a key cannot both be told they won it. Nothing in lite calls it; the big kit's message send dedupe did — see [`docs/scale/messaging.md`](../../../../docs/scale/messaging.md) |
| `EmbeddingProvider.embed` | Batched by construction — one round trip per call, never one per text. A single-string signature is the shape that turns a re-index into a thousand requests. The optional `purpose` says whether the text is a `document` or a `query`: Gemini embeds them differently, and OpenAI ignores it |
| `EmbeddingProvider.model` | Recorded on every chunk it embeds, so vectors from two models are never compared |
| `QueuePublisher` | The deduplication id is a domain rule ("enqueue OCR for this receipt, once"), not queue configuration |
| `UnitOfWork` | The implementation must genuinely enrol the repositories running inside `work()`; one that does not is worse than none |
| `VectorStore.search` | `goalIds` is required so the permission filter runs on the **input** set. Filtering results means the model already saw what the actor cannot. It takes a `model` too, and compares only chunks that model wrote |
| `VectorStore.searchText` | The same shape and scope rule, ranked by Postgres full-text search over the chunk text. What `EMBEDDING_PROVIDER=none` searches with, and it calls nobody |
| `VectorStore.stale`, `saveEmbeddings` | The re-embed pass: chunks whose vector is missing or another model's, then new vectors for them with the text untouched. `ReembedChunksUseCase` is the caller |
