---
title: Subscribers
description: The contract every outbox subscriber keeps — idempotent on the event id, no ordering, never logs — and why they live in application rather than beside the consumer.
---

# Subscribers

A subscriber is a durable reaction to a fact that has already happened. `OutboxConsumer` resolves
one by name and calls `handle(event)`; everything else about it is this contract.

| Subscriber | Listens for | Does |
|---|---|---|
| `member-realtime` | `member.invited` · `member.joined` · `member.role.changed` | publishes a compact frame on the actor's and the subject's user channels |
| `notification` | whatever `NotificationPolicy` has a row for — today the same three | writes one inbox row per recipient the policy names, and queues a mail for those whose preference says so |

## The contract

**Idempotent on `event.id`.** Delivery is at-least-once — that is what every broker offers, and
this one is no different. A duplicate must be a no-op in effect, not a second row, a second email
or a second charge. `member-realtime` is idempotent by construction: it publishes, and a repeated
frame costs a refetch the client would have done anyway. `notification` is not — a second
delivery is a second row — so it buys idempotence from the database instead, with the
`(organization_id, user_id, event_id, kind)` unique index and an upsert that discards the
conflict. That is deliberately not a read-then-write check: two handlers running concurrently
would both pass one. The first subscriber that can buy it from neither is the trigger for a
`processed_event` inbox table, and that trigger is written down rather than left to judgement.

**No ordering.** Two events published in order may be handled out of order. A subscriber that
needs a sequence needs the state, not the sequence.

**It may throw, and it should.** A rejection is that delivery's retry, and no other subscriber's
— which is the whole reason one event becomes one job per subscriber rather than one job that
calls them all.

**It never logs.** It lives in `packages/application`, where the missing
`@loadbearing/observability` import is CI assertion §2. What happened surfaces through the job:
`outbox.delivery.failed` names the subscriber and the event, from the consumer.

**It receives the event, never an actor.** A subscriber that needs a principal builds one from
`event.organizationId`. Handing it the original actor would hand it a permission set resolved at
request time, which may since have changed — and the work is not being done on that person's
behalf anyway.

## Where they live, and why it is not here

Subscribers are in `packages/application`, **in the slice they serve** — not in a folder beside
this consumer. `member-realtime` is a member concern that happens to be triggered by an event;
filing it next to the queue binding would file it by mechanism instead of by subject. `notification`
is the case that makes the rule pay: its recipients come from a policy table read by three
use-cases, and only one of them is reached from a job.

They run **only in the worker**, because `SubscriberRegistry` is consulted only by
`OutboxConsumer`. That is not a convention — it is what makes the in-process dispatch
[Data and scale](../../../../docs/opinions/data-and-scale.md) §7 warns about structurally
impossible: there is nowhere in `apps/web` that can reach one.

## The registry fails at construction, on purpose

`SubscriberRegistry` rejects a duplicate name or an event the catalog does not declare **when it
is built**, so a wiring mistake is a startup crash rather than an event quietly lost at 3am.

The name matters more than it looks: it is half of every job id. Two subscribers sharing one would
deduplicate against each other, and one of them would silently never run.
