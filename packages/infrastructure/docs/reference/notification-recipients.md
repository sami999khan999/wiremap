---
title: Notification recipients
description: Three ways to resolve an audience, the correlated EXISTS that keeps one of them a single statement, and why a list of ids from a routed table is two reads rather than one join.
---

# `PgNotificationRecipientReader`

Three questions: everyone in the tenant (`organizationMembers`), one subject (`user`), and a page of
ids the caller already has (`users`).

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

## `users` is one statement for a page of ids

The digest resolves addresses a page at a time, and `users(organizationId, ids)` answers one page
in one statement, with the `deactivatedAt` filter applied. **One query per page, not one per
recipient** — one per recipient is the shape that turns a fan-out into an outage.

This reader is **catalog**, and wholly so. A caller whose ids live on a routed table reads them
there first and hands them to `users` — two statements, never one join across placements.
`check-architecture` §22 fails a repository whose tables span two placements, and the exemption set
exists to be empty. The big kit's conversation audience was the one read built this way; it left
with [messaging](../../../../docs/scale/messaging.md).

## What this reader deliberately does not do

It does not filter out the actor. `DeliverNotificationUseCase` does that, because "everyone in the
tenant" and "everyone who should hear about this" are different questions and only the second one
knows who caused the event.

It does not resolve copy or locale beyond reading the column. An unrecognised locale falls back to
`en` here rather than asking `ContentSource` for a catalog that does not exist.

---

See also [sharding](sharding.md) for what `routed` and `catalog` mean, and
[the notification policy](../../../application/docs/reference/notification-policy.md) for which
audience each event asks for.
