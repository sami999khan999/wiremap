---
title: The Better Auth boundary
description: Why both clients throw instead of returning { data, error }, why a successful sign-in can be a failure, and the code-then-status table BetterAuthErrorNormalizer maps with.
---

# The Better Auth boundary

`AuthClient` and `AccountClient` are the only files in the repository that name Better Auth's
client. Everything above them sees `AppError` and promises that resolve or throw. This page is why
that translation is not cosmetic.

## Two inferred client types, one instance

`createClient` is not exported and exists for its return type. `ReturnType<typeof createAuthClient>`
is the **unconfigured** client — the two-factor plugin widens the instance, and annotating with the
unconfigured type erases that, so `client.twoFactor` does not exist. The type has to be inferred
from the options and read back out. It is the same trap `AuthFactory.create` hits on the server
side; see [`auth/docs/reference/auth-factory.md`](../../../auth/docs/reference/auth-factory.md).

`AccountClient` takes the `AuthClient` rather than a config, so there is **one Better Auth instance
per component tree**: a fetch here and a `getSession()` there share the same cookie handling and the
same plugin set. The split between the two classes is the one the route groups already draw —
`(shell)` versus `_authenticated` — and only one of them is ever rendered to an anonymous visitor.

## Throwing is what makes the error codes reachable

Every method throws rather than returning `{ data, error }`, and throws an `AppError` rather than a
bare `Error`. The second half is the load-bearing one: `ErrorNormalizer` recognises an `AppError`
structurally and maps everything else to `INTERNAL`, so a plain `Error` thrown here makes **every
branch a caller could write on the code unreachable**. That was the bug `T-005` closed for the
two-factor fork.

## A successful sign-in that is not one

With a second factor enrolled, Better Auth answers `200 { twoFactorRedirect: true }` and no `error`.
A client that only inspects `error` resolves, `onSuccess` fires, and the app navigates away from a
sign-in that never completed.

```ts
if ((data as { twoFactorRedirect?: boolean } | null)?.twoFactorRedirect === true) {
  throw new TwoFactorRequiredError();
}
```

Turning it into a throw puts both legs of the flow on one path: the caller branches on the code,
exactly once. The second leg has three alternatives rather than a sequence — the authenticator app,
a backup code for the phone that is gone, or a mailed code for the phone that is merely elsewhere —
and all three throw on a bad code, so a form uses one error path rather than three.

## `BetterAuthErrorNormalizer`: code first, then status

`BetterAuthError` is declared structurally rather than imported: the library's own error type is
generic over the configured plugins, and this file reads three fields.

**By code.** Only the codes a form branches on are listed; everything else falls through.

| Better Auth code | Becomes | Why |
|---|---|---|
| `USER_ALREADY_EXISTS`, `…_USE_ANOTHER_EMAIL` | `ConflictError("user", "email")` | |
| `INVALID_TOKEN`, `TOKEN_EXPIRED`, `INVALID_OR_EXPIRED_TOKEN` | `ValidationError` on `token`, rule `invalid` | A user cannot act on the difference between "expired" and "already used" — both mean "ask for a new one" |
| `PASSWORD_TOO_SHORT` / `…_TOO_LONG` | `ValidationError` on `password` | |
| `NOT_A_MEMBER` | `ForbiddenError("organization.switch")` | |
| `INVITATION_NOT_CLAIMABLE` | `NotFoundError("invitation", "token")` | `NOT_FOUND` rather than `FORBIDDEN` for a dead invitation: it is the code the landing page has copy for, and a 403 reads as "please sign in" — which they just did |

**By status, when no code matched.** The status, never the message: `error.message` is Better Auth's
English prose, and matching on it breaks on their next release and in every locale but one.

| Status | Becomes |
|---|---|
| 429 | `RateLimitedError("auth")` |
| 400 | `ValidationError` with no violations at all |
| 401 | `UnauthorizedError("rejected")` |
| 403 | `ForbiddenError("rejected")` |
| anything else | `InternalError()` |

**401 and 403 are different answers and get different arms.** A 401 is "we do not know who you
are", whose copy is "please sign in"; a 403 is a signed-in user who may not, and telling them to
sign in is advice that cannot help and reads as a broken session. They shared an arm until `P2.17`.

**The 400 arm carries no violation, because it has no field to name.** It used to build one with an
empty `field`, and every `error.field.*` template opens with `{field}` — so the sentence rendered as
" is not valid.", opening on a space. `ErrorCopy.field` now falls back to the generic sentence for
any violation naming no field, so a second producer cannot reintroduce it.

## Method-level decisions worth knowing

| Method | Decision |
|---|---|
| `signUp` | No session is issued: `autoSignIn` is off and verification is required, so success means "go and read your email" |
| `signInWithGoogle`, `linkGoogle` | Better Auth navigates the browser away, so the normal path is that the call is still pending when the page unloads. An error is a misconfiguration, not a user mistake |
| `requestPasswordReset` | Deliberately resolves on a rejection too. One message either way, because a distinguishable error is an oracle for which addresses are registered |
| `changePassword` | `revokeOtherSessions: true` is not optional: changing a password because it may be known to someone else, and leaving their session alive, is the failure the flow exists to prevent |
| `changeEmail` | The confirmation goes to the address being moved *away from* — the server decides that, not this call |
| `enableTwoFactor` | The password is not ceremony: without it, a stolen session could enrol its own authenticator and lock the owner out permanently. Two-factor is **not** on when this resolves — `verifyTotpEnrolment` proves the secret reached an app first |
| `regenerateBackupCodes` | Invalidating every previous code is the point of the flow, not a side effect |
| `unlinkAccount` | The caller decides whether it is allowed — only it can see the whole list. Better Auth's `allowUnlinkingAll` stays at its default `false` as the backstop |
| `revokeOtherSessions` | Every session but this one, so it is usable from a settings page. `signOut` is the other button |
| `signOut` | Throws like every other write. `useSignOut` clears the whole cache in `onSuccess`, and clearing it over a session the server still honours leaves a signed-out shell in front of a signed-in user |

`listAccounts` and `listSessions` serialise dates with `toISOString()`. A `Date` dehydrates to a
string and rehydrates as one through the TanStack Query cache, so the type would be a lie on the
second render.

## Why the vanilla client

`better-auth/react`'s `useSession` keeps its own cache with its own invalidation rules, which puts
two caching systems in one app — and they disagree on sign-out, showing a signed-in shell wrapped
around a run of 401s. Wrapping the vanilla client here puts session state in the same cache as
everything else, through `SessionStore`. One owner, one invalidation story.
