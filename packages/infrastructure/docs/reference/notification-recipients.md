---
title: Notification recipients
description: Four ways to resolve an audience, the correlated EXISTS that keeps one of them a single statement, and the one read that is deliberately two.
---

# `PgNotificationRecipientReader`

Four questions, one per audience a `NotificationPolicy` row can name: everyone in the tenant,
everyone in a conversation, one subject, and a page of ids the digest already has.

Every one of them is **tenant-scoped and joined through `memberships`**. That is not defensive
repetition: a recipient list that cannot be narrowed by organization is a cross-tenant leak with
an email address attached, and joining through `memberships` rather than `users` is what makes a
deactivated member stop being notified even while their other rows survive.

## `organizationMembers` and the correlated `EXISTS`

The `holding` argument narrows an audience to members whose role grants a permission — "everyone
who can manage billing", not "everyone". It is a correlated `EXISTS` on `role_permissions`
against the membership's own `role_id`, which keeps the whole thing **one statement**.

The alternative shapes are both worse. A join to `role_permissions` multiplies rows when a role
grants the permission more than once, and the fix is a `DISTINCT` over the whole recipient set. A
second query returns a role id list to filter in memory, which is a second round trip and an
unbounded array.

Keyset on `user_id`, because this is the paged one: the digest walks a tenant a page at a time and
`OFFSET` over a large membership reads every row it skips.

## `conversationMembers` is two statements, and that is the design

This is the one read in the repository that used to cross a placement. `conversation_members` is
**routed** — it is tenant-produced data — and `users` and `memberships` are **catalog**. One join
over the three worked on a single Postgres and had no plan at all once the two sit on different
physical databases.

So it is split the way decision D15 prescribes for a crossing read, and split *before* the
transaction rather than inside it:

1. `ConversationRepository.memberIds(organizationId, conversationId, limit)` on the routed shard.
2. `users(organizationId, memberIds)` on the catalog — already written, already one statement,
   already applying the `deactivatedAt` filter this needs.

**Two queries per fan-out, not two per recipient.** The count is bounded by the page, which is the
property that mattered; one query per recipient is the shape that turns a fan-out into an outage.

The cap moved with the split. It used to apply after the join, so `limit` meant "up to N *active*
recipients"; it now caps the routed read, so it means "up to N members, minus any deactivated".
`RECIPIENT_LIMIT` is 500 and is a fan-out ceiling rather than a page size — a conversation past it
is outside what this supports either way — so the difference is not one a caller can observe
usefully. The ids are ordered and the result re-sorted, so two calls over the same conversation
return the same list.

**Why not keep the join and exempt it?** `check-architecture` §22 fails a repository whose tables
span two placements, and the exemption set exists to be empty. An exception carried to the split
is an exception nobody re-examines at the split, which is exactly when it stops being safe.

## What this reader deliberately does not do

It does not filter out the actor. `DeliverNotificationUseCase` does that, because "everyone in the
conversation" and "everyone who should hear about this" are different questions and only the
second one knows who caused the event.

It does not resolve copy or locale beyond reading the column. An unrecognised locale falls back to
`en` here rather than asking `ContentSource` for a catalog that does not exist.

---

See also [sharding](sharding.md) for what `routed` and `catalog` mean, and
[the notification policy](../../../application/docs/reference/notification-policy.md) for which
audience each event asks for.
