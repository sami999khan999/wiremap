---
title: Membership enrolment
description: Why a session is refused to a user with no membership, the three modes that give them one, the invitation claim that runs before any of them, and why tenancy is a binding in the DI root rather than a policy baked into an adapter.
---

# Membership enrolment

`AuthFactory` refuses a session to a user who belongs to no organization:

```ts
const organizationId =
  (await memberships.activeOrganizationFor(userId)) ?? (await enroller.enrol(userId));

if (!organizationId) return false;
```

That is the tenancy gate, and everything on this page exists because of it. A sign-up that produces
an account and no membership produces a user who can never sign in — correctly, and with nothing in
either log saying why. **Enrolment is what stops the gate being a wall.**

## Why it runs from `session.create.before`

Not `user.create.after`. Better Auth queues `create.after` hooks until the whole sign-up endpoint has
finished, which is *after* the session hook has already run and refused the session. The session
hook is the first moment a membership can exist and still be seen by the code that needs it.

It costs nothing on the sign-in path: `activeOrganizationFor` answers on every session after the
first, so `enrol` runs exactly once per user, ever.

The hook asks `MembershipReader.isSuspended` first, and throws `ACCOUNT_SUSPENDED` rather than
returning `false`. The order matters. A suspended user's `activeOrganizationFor` is null, and in
`bootstrap` mode `enrol` would find their existing membership and hand the tenant straight back,
opening a session for an account the platform locked. The password was right by then, so naming
the reason tells nobody whether an address has an account.

## Three modes, one decorator, one binding

`AUTH_ENROLMENT_MODE` picks one of three `MembershipEnroller` implementations, and `Container` is
the only place in the system that branches on it:

| Mode | Implementation | What an *uninvited* new user gets |
|---|---|---|
| `personal` *(default)* | `PgPersonalOrganizationEnroller` | An organization of their own, seeded with the four system roles, and `owner` in it |
| `bootstrap` | `PgBootstrapMembershipEnroller` | Membership of the one organization named by `BOOTSTRAP_ORGANIZATION_SLUG` — first in as `owner`, everyone after as `member` |
| `invite` | `NullMembershipEnroller` | Nothing. Their first sign-in is refused |

Every one of them is wrapped in `InvitationClaimingEnroller` before it is handed to `AuthFactory`:

```ts
enrol(userId) = (await claimer.claimPending(userId)) ?? inner.enrol(userId)
```

**An invited address joins the organization that invited it, and the mode is never consulted.**
That order is the tenancy decision the kit makes: a person who arrives through an invitation does
not also get a personal organization. Swapping the two lines is the other model, and it is one line.

**Tenancy is the decision a starter kit is most likely to be forked over**, which is why it is a
binding rather than a policy inside one adapter. Adding a fourth mode is a class and one line in
`Container.enroller`; nothing above it moves.

`personal` is the default because it is the only mode that works against an empty database. A fresh
clone can sign up and be signed in without `pnpm db:seed` having run, and the second person to sign
up gets their own tenant rather than joining the first person's.

`bootstrap` is right for a demo or a single-tenant install and **wrong for anything reachable from
the internet**: with it on, the sign-up form hands out membership of your organization to whoever
finds it.

`invite` is the production posture. With the decorator around `NullMembershipEnroller`, an invitation
is the only door: an invited address is enrolled, and anyone else's first sign-in is refused. It is
not a disabled state — the refused session is the system working.

## What a claim checks, and where

`InvitationClaimer` is the write path from `invitations` to `memberships`. It has two entry points —
`claimPending(userId)` for the enrolment hook, which holds no token, and `claimByToken(userId,
token)` for the accept endpoint, which does — and both run the same query with one predicate that
must never be relaxed:

> The invitation's address equals the **verified** address on the user row.

`invitations.token_hash` holds the **digest**, not the token. The plaintext exists in exactly two
places — the mail that was sent, and the URL the recipient is holding — so a dump of the table
carries nothing anyone can accept with. `PgInvitationClaimer` hashes on the way in, which is why a
lookup written against a raw token would silently find no invitation rather than fail loudly.

That is the whole security model. A token is only how the row is found; the mailbox the invitation
was sent to is the credential. Without the verification check anyone could register as the invited
email and walk into the tenant, which is why the check lives in `PgInvitationClaimer`'s query rather
than in a caller that might forget it.

**A failed invitation mail does not undo the invitation.** The send is now an enqueue, and it still
happens after the commit — a message about a row that rolled back is a link to nothing — so by the
time anything can fail there is a live row and an audit entry. `InviteMemberUseCase` returns the
record rather than answering 5xx over it, and the `try`/`catch` stays for one specific reason: the
plaintext token cannot ride a durable row (that is what `token_hash` exists to prevent), so the
enqueue is the one step that cannot be made atomic with the invitation.

The window that leaves is a crash between the commit and the enqueue, and the answer to it is a
resend action rather than a delivery table — filed as `C6.9` in
[`plans/archive/COMMUNICATION-PLAN.md`](https://github.com/prodicle/loadbearing_tanstack_start_kit/blob/3fafa78c2f42d2d718236d7666429b858199118a/plans/archive/COMMUNICATION-PLAN.md). Once the job is on the
queue, BullMQ's retries and backoff cover a transport that is down, and `MailConsumer` emits
`mail.delivery.failed` on the final attempt. The operator action is still to invite again, which
replaces the row and issues a new token.

It follows that **invitations require email verification**. Under
`AUTH_REQUIRE_EMAIL_VERIFICATION=false` no user row is ever verified, so no claim ever matches and
an invited person falls through to the mode's own answer. That is fail-closed, and it is deliberate:
the alternative is a demo flag that silently becomes an account-takeover path.

Two more properties, both from the schema:

- Only *pending* invitations exist. A claim deletes the row and writes the membership; a revoke
  deletes the row. The audit log (`member.joined`, `member.invited`, `member.invitation.revoked`)
  carries the history, so there is no status column and no listing filtered by one.
- `memberships_uq` is on `(organization_id, user_id)`, so a claim by someone already in the tenant
  is an `onConflictDoNothing` — the invitation is consumed and the role they hold is untouched.

## The lock, and what it is protecting

All three Postgres writers do the whole read-decide-write inside one transaction behind
`pg_advisory_xact_lock`. They lock on different things, and the difference is the point:

- **Bootstrap locks the organization.** Two sign-ups racing on an empty organization both read "no
  members yet" and both land as `owner`. `owner` is the wildcard role, so the cost of losing that
  race is a second account holding every permission in the registry.
- **Personal locks the user**, because the organization does not exist yet. Losing that race means
  two organizations and two owner memberships for one person, with the session hook free to pick
  either — so half their data lands in a tenant they cannot reach.
- **The claimer locks the user too, on the same key.** A claim and a personal enrolment racing for
  one brand-new user therefore serialise, and the second to arrive sees the first's membership.

Both enrollers re-check for an existing membership *inside* the lock, which is what makes a retried
request return the organization the first attempt chose rather than enrol the user twice. Better
Auth does retry.

## One founder, two callers

Creating a tenant — the `organizations` row, the four system roles, the `owner` membership, the
`organization.created` audit row — is `PgOrganizationFounder.found()`, and it has exactly two
callers: the personal enroller at a first sign-in, and the "New organization" endpoint. Both must
produce an organization indistinguishable from a seeded one, which is why the founder calls the
same `SystemRoleSeed` that `pnpm db:seed` calls. It resolves `owner`'s wildcard through
`PermissionRegistry.instance.all()`, so an organization created at sign-in holds exactly the grants
a seeded one would. A second copy of that logic is a second permission model, and the divergence
would first show up as one tenant being unable to use a feature every other tenant has.

The founder opens its transaction on `this.db` rather than on the pool. Called from inside the
enroller's locked transaction that is a savepoint, so the lock and the idempotency check above still
cover it; called from the endpoint it is a transaction of its own.

**The port carries the optional `slug`.** The personal enroller passes `u-<userId>`, and for a while
the port's `found(userId, name)` could not express that — so `Container` held the concrete
`PgOrganizationFounder` beside the port field purely to reach past it. A port whose only caller has
to bypass it is one the composition root bypasses too, which is where the ban on naming a concrete
adapter outside `composition` quietly stops meaning anything. `slug` is optional and derived from
the new id when absent; nothing routes by it.

Making that reuse possible is why the runnable seed script lives at
`packages/infrastructure/seed.ts`, above `src/`. It used to be `src/pg/seed/index.ts` — the folder
barrel — so importing it for `SystemRoleSeed` would have connected to Postgres and called
`process.exit` in the middle of a sign-in.

## Which organization a sign-in lands in

`MembershipReader.activeOrganizationFor` prefers `users.last_active_organization_id` — written by
the switch endpoint — **while the user is still a member of it**, and the oldest membership
otherwise. The re-check matters: a preference pointing at a tenant they were removed from must not
put a session there, and `PgMembershipReader` does it in one query with a sort rather than a second
round trip.

## Naming a tenant nobody named

A personal organization is named after its owner and slugged from their id; one created on demand is
named as typed and slugged from its own id:

```ts
slug: `u-${userId}`,            // personal
slug: `o-${organizationId}`,    // "New organization"
```

The name is the user's own, so `packages/infrastructure` writes no English and needs no locale to
name a row. The slug is derived from an id rather than from the name or the email because a slug
built from user input needs a normalisation pass and a collision strategy — and
`organizations_slug_uq` would otherwise turn the second person called Grace Hopper into a failed
sign-in. Nothing routes by slug today; when something does, that is the moment to give it a real
one.

## Related

- [`principal-builder.md`](./principal-builder.md) — what the resolved tenant is used for.
- [`capability-cache.md`](./capability-cache.md) — the cache keyed on `organization:user`.
