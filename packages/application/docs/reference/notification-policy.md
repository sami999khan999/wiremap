---
title: The notification policy
description: What an event means to a person — who hears about it, in which channel, and why the unread count is cached while the rows never are.
---

# The notification policy

`NotificationPolicy` is a frozen table with one row per event that produces a notification.
Everything about "who gets told what" is decided there and nowhere else.

| Event | Kind | Recipients | In-app | Email |
|---|---|---|---|---|
| `member.invited` | — | **nobody** | off | off |
| `member.joined` | `member.joined` | members holding `member.invite` | immediate | digest |
| `member.role.changed` | `member.role.changed` | the member it happened to | immediate | immediate |

**`member.invited` has a row whose recipients are `none` rather than no row at all.** "We
considered this and there is nobody to tell" is worth writing down: the invitee has no account
yet, so there is no inbox to write to, and the invitation mail *is* the notification.

**`member.joined` goes to the people who can act on it, not to the organization.** A hundred-person
tenant would otherwise write a hundred rows per joiner, which is the write amplification
[Data and scale](../../../../docs/opinions/data-and-scale.md) §6 names.

**`member.role.changed` emails immediately.** What somebody may do just changed, and it is the one
thing they cannot discover by looking.

## `conversationMembers` costs two queries, and the other audiences cost one

The audience a row names is resolved by `NotificationRecipientReader`, and three of the four are
a single statement. `conversationMembers` is two, because `conversation_members` is routed and
`users` and `memberships` are catalog — see
[the recipient reader](../../../infrastructure/docs/reference/notification-recipients.md).

That matters when writing a new policy row: an audience is resolved once per event, so the
difference is one extra round trip per delivery rather than per recipient. What would not be
acceptable is an audience whose resolution is one query *per* recipient, and no row here asks
for one.

## The subscriber's `events` list *is* this table's keys

`NotificationSubscriber.events` is `NotificationPolicy.events()`. A row added here is delivered
with no second edit, and a spec asserts the two never diverge. The alternative — a hand-written
list beside the table — is a second place to forget.

## The dedupe key is `(organization_id, user_id, event_id, kind)`

Delivery is at-least-once, so a replayed event has to find a row rather than write a second one.
That is a unique index, not a read-then-write check: a second handler running concurrently would
pass the check too.

`saveMany` reports which rows were **actually new**, and only those recipients are mailed or framed.
So a replayed event is silent all the way down rather than merely not duplicating the row.

## The actor is never a recipient

Being told about a thing you just did is noise, and it is the single most common reason a
notification system gets muted. `member.joined` filters the actor out of its audience explicitly.

## Why the count is cached and the rows are not

The bell is on **every page**; the list is on one. An uncached count is therefore one query per
navigation per user, and at 100k DAU that is the query that hurts first.

So `notification:unread:<org>:<user>` is a read-through cache with a sixty-second TTL, and
**Postgres stays the truth**. Every write for that user deletes the key — marking one read, marking
all read, and a delivery writing a new row — because a badge a minute behind a row the reader has
already cleared reads as the feature being broken rather than as a cache.

It is also **capped at 100, in SQL**. Past that the badge says "99+", so counting further is work
nobody reads over a table that grows forever. The `LIMIT` lives inside the subquery precisely so
Postgres stops counting rather than counting and then discarding.

The rows themselves are never cached. They are paged by keyset, they are per-user, and a stale one
is a lie about something the person is looking at.

## Preferences resolve, they do not merely load

`GetNotificationPreferencesUseCase` returns the complete category × channel grid, defaulting each
cell from the policy. An absent row means "never changed", so a form rendering only what was saved
shows an empty screen on day one — which reads as broken rather than as untouched.

`off` on the in-app channel silences the frame, not the row: the inbox still has it, and the person
simply is not interrupted. That distinction is why the channel is called `in_app` rather than
`inbox`.

## What the recipient filter can and cannot see

`PgNotificationRecipientReader` filters by a correlated `EXISTS` on `role_permissions`, which keeps
the whole recipient query one statement.

It is deliberately the **coarse** filter and not a resolved `CapabilitySet`: a per-user deny
override could still let somebody be notified about a page they cannot open. That is a wasted
notification rather than a leak — the realtime frame carries no data, and the row carries only the
actor's id. Resolving capabilities per recipient is the cost §6 warns about, and it would turn one
statement into one per person.
