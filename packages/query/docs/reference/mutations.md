---
title: Mutations and invalidation
description: Why useAppMutation invalidates before onSuccess, how a declared optimistic edit rolls itself back, why sign-out and organization switch declare no invalidation at all, and the rule for deciding what each mutation invalidates.
---

# Mutations and invalidation

Every mutation in this package is a static factory on a class — `SessionMutations.useSignIn(auth)`,
`AccountMutations.useChangePassword(client)`. A class of static hook factories is fine because the
hook rules apply at the **call site**, and each of these is called unconditionally at the top of a
component.

The split between the classes is the one `AuthClient` and `AccountClient` already draw:
`SessionMutations` is everything an anonymous visitor can start, `AccountMutations` is everything a
signed-in person can change about their own account.

## Invalidate before `onSuccess`

`useAppMutation` runs its `invalidates` list **before** the caller's `onSuccess`. That order is the
contract: a caller that navigates in `onSuccess` must be navigating to a cache that has already been
marked stale, or the destination renders the value the mutation just changed.

## The three states of `invalidates`

**A key.** The ordinary case: the mutation changed something a query reads.

| Mutation | Invalidates | Why |
|---|---|---|
| `useUpdateName` | `["session"]` | The rendered name lives on the session snapshot |
| `useVerifyTotpEnrolment` | `["session"]` | The moment two-factor actually becomes true — `user.twoFactorEnabled` is what the security page renders |
| `useChangePassword` | the session **list** | `revokeOtherSessions` is set, so every other device is gone and the list on screen is wrong. This tab's own session survives, which is why `QueryKeys.session` is absent |
| `useInvite`, `useRevokeInvitation` | `member.all()` | A re-invite replaces a pending row and the member list sits beside it, so both refetch together |
| `useVerifyTotp`, `useVerifyBackupCode`, `useVerifyOtp` | `session.all()` | Each one completes a sign-in that answered `TWO_FACTOR_REQUIRED`, so the session the route is about to read is the one that just came into being |

**Nothing, because nothing changed yet.** These are not omissions:

| Mutation | Why no invalidation |
|---|---|
| `useSignUp` | No session is issued — verification is required and `autoSignIn` is off — so invalidating `["session"]` refetches a session that is still, correctly, anonymous |
| `useChangeEmail` | A confirmation was sent to the *old* address; the address on the session moves only once that link is followed |
| `useEnableTwoFactor` | Two-factor is not on yet. Invalidating here makes the page claim protection the account does not have |
| `useSignInWithGoogle`, `useLinkGoogle` | The success path is a full-page navigation to Google. Nothing in this cache survives to be invalidated; the settings page refetches when the browser returns |
| `useSendOtp` | It sends a code and completes nothing. There is no session yet to refetch |

**Nothing, because the whole cache has to go.** Sign-out and the three organization actions.

### `TwoFactorForm` went through the client for a while, and that is the shape to recognise

Four raw `AuthClient` calls behind a hand-rolled `pending`/`failed` pair, with a comment saying
there was "no session to invalidate until this succeeds". Half true: the *verification* is exactly
the moment one comes into being, and the route's own `complete()` was carrying what an
`invalidates` line says in one place.

The tell is not the raw call — it is the local `useState` that reimplements `isPending` and
`isError` beside it. A form doing that is a form the seam is not serving, and the fix is a defined
mutation rather than better local state. `mutation.reset()` is the piece the hand-rolled version had
no equivalent for: four mutations each keep their own `isError`, and switching method must not leave
the reader looking at a failure that belongs to the method they left.

## `optimistic` is a declared edit, not four steps at each call site

Three mutations remove a row the user is looking at — revoke a session, revoke an invitation, unlink
an account — and for those the row *is* the feedback. Waiting for a round trip to take away something
the user just clicked away reads as a click that did nothing.

Done by hand that is four steps, and three of them are the ones people forget:

```ts
optimistic: {
  queryKey: QueryKeys.account.sessions(),
  apply: (cached, { token }) => cached.filter((session) => session.token !== token),
},
```

- **Cancel before writing.** A refetch already in flight resolves with the server's *pre*-mutation
  answer and puts the row straight back. This is the step whose absence looks like a flicker nobody
  can reproduce.
- **Snapshot, and restore before the caller's `onError`.** A failure handler often renders the
  message beside the row, and the row has to be back for that to mean anything.
- **Invalidate the optimistic key on success, whether or not `invalidates` names it.** An edit the
  server never confirmed would otherwise sit there until something else refetched.

**`apply` receives the snapshot and must not mutate it.** It is the same object the rollback holds:
editing in place leaves nothing to restore.

**A paginated list makes the hook take its page.** `useRevokeInvitation(client, params)` needs the
params because they are part of the cache key — an optimistic edit has to know *which* list the row
is on, and pretending otherwise would silently edit page one while the reader is on page two. The
component builds that object once and hands it to both the query and the mutation; building it per
render is fine, because a query key is hashed structurally rather than by identity.

**When the cached value is `undefined`, nothing happens and nothing is restored.** That is not a
failure — it means the list is not on screen, and the invalidation on success covers it.

## Sign-out and switch clear the cache at the call site

`useSignOut` and every `OrganizationMutations` hook declare no `invalidates`, and that is the point.

After a sign-out or a tenant switch, **every cached row in the client belongs to the tenant just
left**. The only correct invalidation is `queryClient.clear()`, and that is a lifecycle decision the
call site makes rather than something this package can decide: the desktop shell may want to keep an
offline cache across a sign-out.

Invalidating only `["session"]` is the failure mode worth naming. It leaves every other query in
memory, so the next person to sign in on that machine sees a flash of the previous user's data
before the refetch lands.

The call sites do the same four things, in order — clear the query cache, invalidate the session
store, re-run the root loader, navigate — which is why `apps/web` factors that into one helper
rather than repeating it.

## Keys mirror procedure paths, parameters last

`contract.task.list` becomes `["task", "list", params]`. Given a procedure you can write its key
without looking anything up, which is the same derivability the file-naming rules have.

Every namespace has `all()`, because TanStack matches by prefix: one call catches every list and
detail below it, and that is what makes invalidation trustworthy.

`account` is deliberately **not** under `session`. Those rows outlive a single session record — the
linked-account list is a property of the user — and putting them under `session` would refetch three
lists every time a session is refreshed.

## Stale times are backstops, not the mechanism

Every query in this package is invalidated by the mutation that changes it. `staleTime` exists for
the *other* tab, and the numbers say how long a lie is tolerable:

| Query | Stale time | Why |
|---|---|---|
| Linked accounts, roles, members | a minute | Changed only by a mutation on the same page, each of which invalidates |
| Active sessions, invitations | shorter | A session can end, or an invitation be accepted from another device, with this tab doing nothing — and "where you are signed in" showing a minute-old answer is a screen that lies about the thing it exists for |

Retries come from the error catalog rather than from a per-query setting: retryability is a fact
about the code. A `FORBIDDEN` retried twice with backoff turns an instant "you cannot do that" into
a three-second wait for the same answer. A signed-out session query is an answer, not a failure to
retry, so it retries never.

## A cursor page is one query key, not one per page

`useAppInfiniteQuery` is the same pass-through as `useAppQuery`, and it exists for the same reason:
so a call site names one hook rather than the library's. Its five type parameters are copied from
the library's signature verbatim — with fewer, `data` collapses to `unknown` at every call site,
which typechecks and then loses every field.

The rule it enforces is about the key. A keyset list's cursor lives in the **page data**, never in
the query key: `["notification", "list", { limit, unreadOnly }]` covers page one and page forty
alike, so one `invalidate` on that key refetches the whole scroll and a mutation does not have to
know how far the reader got. Putting the cursor in the key gives every page its own cache entry,
none of which any invalidation you would think to write will match.

`getNextPageParam` reads `nextCursor` and nothing else. `items.length < limit` is the tempting
version and it is wrong: a full last page is ordinary, and the server is the only party that knows
whether a row follows the one it just sent.
