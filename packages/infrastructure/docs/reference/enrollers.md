---
title: Enrollers, the founder, and the claimer
description: The four Postgres adapters that put the first row in memberships — the advisory locks they take, the races those locks are protecting, and why every one of them binds structurally rather than by name.
---

# Enrollers, the founder, and the claimer

Four classes in `pg/repository/` write the artifact a session is refused without:

| Class | Port in `auth` | Mode |
|---|---|---|
| `PgPersonalOrganizationEnroller` | `MembershipEnroller` | `personal` — the default |
| `PgBootstrapMembershipEnroller` | `MembershipEnroller` | `bootstrap` |
| `PgInvitationClaimer` | `InvitationClaimer` | wraps all three |
| `PgOrganizationFounder` | `OrganizationFounder` | used by `personal` and by the create endpoint |

Every one of them satisfies its port **structurally**, never nominally. `auth` already depends on
this package, so it cannot import the port and this file cannot import back — the binding is checked
where the two meet, in `Container`. Those constructor lines are where a signature drift is caught.

Which mode is bound is `AUTH_ENROLMENT_MODE`; see
[`auth/docs/reference/enrolment.md`](../../../auth/docs/reference/enrolment.md) and
[`composition/docs/reference/container.md`](../../../composition/docs/reference/container.md).

## One advisory-lock namespace, three keys

`pg_advisory_xact_lock` takes two integers. All three lock-taking classes use **the same fixed
namespace**, so an advisory lock taken here can never collide with one taken for another reason —
and so a claim and an enrolment for one user serialise against each other.

Postgres advisory locks are keyed on integers and an id here is a uuid, so the key is the first
eight hex digits. A collision costs two enrolments serialising against each other, which is what
they were going to do anyway.

| Class | Locked on | The race it is protecting against |
|---|---|---|
| `PgBootstrapMembershipEnroller` | the **organization** | Two sign-ups on an empty organization both read "no members yet" and both land as `owner`. `owner` is the wildcard role, so losing that race is a second account holding every permission in the registry |
| `PgPersonalOrganizationEnroller` | the **user** | The organization does not exist yet. Two sign-ins racing on one brand-new user would produce two organizations and two owner memberships for one person, with the session hook free to pick either |
| `PgInvitationClaimer` | the **user** | A claim and an enrolment racing for one brand-new user would otherwise produce a membership *and* a personal organization |

In each, the whole read-decide-write runs in one transaction behind the lock, and the idempotency
check is **inside** it: a retried request must return the organization the first attempt chose
rather than enrol the user twice.

> [!IMPORTANT]
> **That check is scoped to the organization being enrolled into, not just to the user.** Unscoped,
> `PgBootstrapMembershipEnroller` handed back whichever tenant the user already belonged to — a
> cross-tenant answer out of a lookup that reads like a retry guard. `PgPersonalOrganizationEnroller`
> is the exception and is keyed on the user alone, correctly: the question there is "do they already
> have one of their own", and no organization exists yet to scope by.

## `personal`, and why the slug comes from an id

The default mode, and the only one that works against an empty database: a fresh clone can sign up
and get in with no seed run and no invitation, which is what makes the kit multi-tenant on day one
rather than after a rewrite.

The enroller owns only the lock and the "not if they already have one" decision; the tenant itself
is made by `PgOrganizationFounder`. It must share the repository's `TransactionScope`, or the
founder's savepoint opens on the pool instead of inside the locked transaction.

The organization is named after the person, so this package writes no English and needs no locale to
name a tenant. **The slug is derived from the id, never from the name**: a slug built from user
input needs a normalisation pass and a collision strategy, and nothing in this application routes by
slug.

## `bootstrap`, and what it is not for

Everyone who signs up joins one named organization, first in as `owner` and everyone after as
`member`. Right for a demo, a single-tenant deployment, and local work against `pnpm db:seed` —
and **wrong for anything reachable from the internet**, because the sign-up form then hands out
membership of your tenant.

An undefined slug switches enrolment off entirely, which is the default. A deployment that has built
invitations wants exactly that: an unaffiliated sign-up gets no membership, `MembershipReader`
returns null, and the session is refused.

Both roles are seeded by `SystemRoleSeed`. An organization missing either is one the seed never ran
against, and **enrolment declines rather than guesses** — inventing a role here would be inventing a
permission set.

## `PgOrganizationFounder`: one implementation, two callers

Called from the personal enroller at a first sign-in, and from the create endpoint behind the "New
organization" button. Both must produce an organization indistinguishable from a seeded one, which
is why `SystemRoleSeed` is reused rather than restated: it resolves `owner`'s wildcard through
`PermissionRegistry.instance.all()`, so an organization created here holds exactly the grants
`pnpm db:seed` would have given it.

```ts
return this.db.transaction(async (tx) => { … });
```

`this.db`, not `this.database.client` — called inside the enroller's open transaction this becomes a
**savepoint** and commits with it; called standalone it is a transaction of its own. Either way the
seed and the audit row land in the same unit as the organization.

A missing `owner` role throws and rolls the whole tenant back, which beats a tenant nobody can
administer.

The audit row is written as the tenant that was just created, not the caller's current one, with an
empty capability set: the logger reads only the organization and the actor off the principal.

The file also restates `OrganizationFounder` as an interface, for the same reason
`PgInvitationClaimer` restates `InvitationPreview`: the port lives in `auth`, which is downstream of
this package. `PgPersonalOrganizationEnroller` takes that shape rather than the concrete class, so
`Container` can pass its port field and stay the one place a class is named.

### Warm spares: the founder claims a tenant that already has its partitions

Since `PF.3`, a signup pays no partition DDL. The worker's `spares` job runs every five minutes and
tops `spare_tenants` up to twenty. Each spare is a tenant id whose seventeen partitions exist on node 0
and whose `organizations` row does not. Each is made in one transaction, row and partitions
together, so a crash never leaves partitions that nothing names.

`found` claims the oldest spare with `delete … for update skip locked limit 1 returning id`, inside
its own transaction, and uses that id as the organization's:

- **A failed signup gives the spare back.** The delete rolls back with the rest.
- **A busy pool is an empty pool.** `SKIP LOCKED` falls through instead of queueing two signups
  behind one row.
- **An empty pool seeds inline**, exactly as before spares existed. The pool changes how fast a
  signup is, never whether it succeeds.
- **`TenantPartitionSeed.run` still runs** on a claimed spare, because a spare made last month
  may be a runway month short. For one that is not, it is a single read.

Measured on 2026-09-24 with the real founder, ten foundings each way on a node holding a handful of
tenants: the whole founding transaction took a median **126 ms seeding inline and 21 ms on a
spare**. The inline half grows with the node, because a tenant-level attach checks its bound against
every sibling's: its DDL alone was 377 ms at 2 000 tenants (`partitions.md`). The spare half does
not grow.

Node 0 alone, because the founder places every tenant there and node 0 is the catalog's own
database. That is what lets one transaction hold both the claim and the partitions. The nightly
orphan count and both test sweeps treat a spare as live.

## `PgBootstrapMembershipEnroller` takes its slug in the constructor

It used to take it from `withOrganizationSlug`, a setter returning `this`. An enroller between
construction and that call is one that enrols nobody and says nothing about it — and a fluent setter
on a class the container builds once buys nothing that an argument does not.

## `PgInvitationClaimer`: the verified address is the credential

Deliberately **not** tenant-scoped. The caller arrives holding a token or a user id and no
organization — the tenant is the *answer*, exactly as with
`PgMembershipReader.activeOrganizationFor`.

What scopes a claim instead is one predicate, and it is the one that must never be relaxed:

> the invited address equals the user's **verified** address.

Without it, anyone could register as the invited email and walk into the tenant. With it, the
mailbox the invitation was sent to is the credential and the token is only a lookup key. Under
`AUTH_REQUIRE_EMAIL_VERIFICATION=false` this never matches — **invitations fail closed there**, and
that is the documented behaviour rather than an oversight.

Expiry is compared against database time, the same clock the row was written by. The insert is
idempotent under `memberships_uq (organization_id, user_id)`: someone who is already a member keeps
the role they have, and the invitation is consumed either way.

**The address predicate compares the column, never `lower()` over it.** `InviteMemberUseCase`
lowercases once, on the way in, which is what makes `invitations_email_uq (organization_id, email)`
see one address as one row. Wrapping the column in the query undoes that at read time: the predicate
is then an expression, `invitations_email_idx` cannot serve it, and `claimPending` seq-scans every
pending invitation in the deployment on every sign-up.

`InvitationPreview` is restated here rather than imported for the same dependency-direction reason as
the ports themselves.

## `organizationsFor` is capped at 100

Every row it returns is rendered by the organization switcher, so an unbounded read is a list that
grows without limit — and it is a three-table join whose cost grows with it. The limit is a named
constant on the reader rather than a literal in the query, because the number is a product decision
about when a switcher stops being a switcher.

**Past 100, the answer is search, not a longer list.** A user who is genuinely in more tenants than
that needs a filter box and a paged query, which is a different read with a different index. Adding
one is the change to make when someone hits this; raising the constant is not.

The truncation is silent, deliberately: `MembershipReader` returns a list, and there is no caller
that could do anything useful with "there were more". A caller that needs to know is the same caller
that needs the paged read.

## The uuid cast

`memberships` declares its organization FK as a plain `uuid`; the brand lives on `organizations.id`.
Every one of these classes casts at that boundary, as `PgMembershipReader` does.
