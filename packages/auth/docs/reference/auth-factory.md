---
title: AuthFactory
description: The one place Better Auth is configured, option by option — the two storage traps that put credentials on an LRU cache, the session hook that resolves the tenant, the cookie cache window, and the five rate-limit rules that are not the default twenty.
---

# `AuthFactory`

`AuthFactory.create()` is the only call to `betterAuth()` in the repository. Every option in it is
either a security boundary or the reason a whole surface works; none of it is taste. This page
carries the reasoning, so the file itself can state constraints and stop.

## Why the return type is inferred

`create()` is the one method in this package with no return annotation, and it has to stay that
way. `ReturnType<typeof betterAuth>` is `Auth<BetterAuthOptions>` — the *unconfigured* instance —
and the two-factor plugin widens the user type, so annotating with it fails to assign. The type is
inferred from the options object and read back out:

```ts
export type AuthInstance = ReturnType<typeof AuthFactory.create>;
```

That alias is what every consumer names: `BetterAuthSessionResolver` takes one, `Container` holds
one.

## The two secondary-storage traps

Configuring `secondaryStorage` changes two unrelated defaults, and both of them move a credential
off Postgres and onto the `allkeys-lru` Redis instance.

| Option | Default with secondary storage | What that costs |
|---|---|---|
| `session.storeSessionInDatabase` | Better Auth stops writing the `sessions` row | An ordinary eviction is a random sign-out |
| `verification.storeInDatabase` | The verification table is never created | A reset link stops working, with no error on either side |

Both are set to `true` here. **Redis sits in front of Postgres, never instead of it** — every read
falls through to the table on a miss, which is the property that makes eviction survivable. See
[`docs/opinions/data-and-scale.md`](../../../../docs/opinions/data-and-scale.md) for the rule this
is an instance of.

Rate-limit counters go the other way and use `storage: "secondary-storage"` deliberately: a lost
counter means a few extra attempts, never a lockout.

## The cookie cache window

```ts
cookieCache: { enabled: true, maxAge: config.cookieCacheMaxAgeSeconds }
```

Most requests skip the session lookup entirely. It is the single largest performance win available
in this file and it costs one block — but the window is the same kind of number as the
`CapabilityCache` TTL: it is how long a revoked session keeps working. `env.ts` caps
`AUTH_COOKIE_CACHE_MAX_AGE_SECONDS` at 60 so a deploy that raises it fails at boot rather than
quietly widening that gap. See [`capability-cache.md`](./capability-cache.md).

## The session-create hook resolves the tenant

`databaseHooks.session.create.before` is where a session acquires its `activeOrganizationId`. It
resolves the tenant once, at sign-in, so every later request reads it off a session Better Auth was
going to load anyway.

```ts
const organizationId =
  (await memberships.activeOrganizationFor(userId)) ?? (await enroller.enrol(userId));

if (!organizationId) return false;
```

Two decisions are load-bearing here:

- **The reader runs first.** It answers on every session after the first — enrolment is not on the
  sign-in path.
- **This is not a `user.create.after` hook.** Better Auth queues those until the whole sign-up
  endpoint has finished, which is *after* this hook has already run and refused the session. This
  is the first moment a membership can exist and still be seen by the code that needs it.

Returning `false` aborts the session, so a user with no membership gets a failed sign-in rather
than an unscoped principal. Which enroller is bound is `AUTH_ENROLMENT_MODE` — see
[`enrolment.md`](./enrolment.md).

`surface` is pinned in the same hook from the request origin, and both it and
`activeOrganizationId` are declared `input: false`: that is what stops a sign-up body from naming
its own tenant or claiming a surface.

## Desktop origins

```ts
const DESKTOP_ORIGINS = ["tauri://localhost", "http://tauri.localhost"] as const;
```

Both, because the scheme genuinely differs by platform — `tauri://localhost` on macOS and Linux,
`http://tauri.localhost` on Windows. Shipping one produces an app that works for half the team.
The `bearer()` plugin is not optional for the same reason: a session cookie is never sent
cross-origin, and the Tauri webview is always cross-origin.

## Rate limits: twenty is for endpoints nobody attacks

The global rule is 20 a minute. It is far too loose for five paths, each of which is either a guess
against a credential or an email this server pays to send:

| Path | Window | Max |
|---|---|---|
| `/sign-in/email` | 60 s | 10 |
| `/sign-up/email` | 60 s | 5 |
| `/request-password-reset` | 60 s | 3 |
| `/send-verification-email` | 60 s | 3 |
| `/two-factor/send-otp` | 60 s | 3 |
| `/organization/create` | 60 s | 5 |
| `/invitation/accept` | 60 s | 5 |
| `/organization/switch` | 60 s | 20 |

Paths are Better Auth's own, relative to `basePath`, and are verified against the pinned runtime:
**a rule keyed on a path that does not exist silently rate-limits nothing.** Creating a tenant seeds
a role set and accepting an invitation is a guess against a token, which is why the organization
plugin's paths are down here too — see [`organization-plugin.md`](./organization-plugin.md).

## Credential options, and what each one prevents

**Every one of these four hooks now enqueues rather than sends.** `AuthMailer` takes a
`MailRecipient` — address, user id, and the locale from `users.locale`, which Better Auth carries as
an additional field — instead of a bare address, and `QueuedAuthMailer` turns each call into a job on
`QueueName.MAIL`. Two consequences worth knowing before the first local sign-up:

- **The worker must be running for any of this mail to arrive.** A stopped worker means a
  verification link that is queued and never rendered. That is the price of one send path, and it is
  the reason auth mail is published at `high` priority with five attempts.
- Better Auth's hooks are the reason the recipient is a shape rather than a string. They are called
  from a token endpoint that carries no request, so the old implementation composed every message in
  the default locale and there was nowhere to put the person's own.

`AuthFactory.recipient` normalises `user.locale` against the known locales rather than trusting it.
It is an additional field and therefore loosely typed, and an unrecognised value would otherwise
reach `ContentSource.translator` and ask for a catalog that does not exist.

| Option | Value | The failure it prevents |
|---|---|---|
| `revokeSessionsOnPasswordReset` | `true` | The difference between "changed my password" and "actually locked them out" |
| `sendResetPassword` | mailer | Without it the reset endpoint mints a token with nowhere to send it — "forgot password" returns 200 and is a dead end |
| `minPasswordLength` | 12 | Better Auth defaults to 8; length is the only defence a password rule actually buys |
| `maxPasswordLength` | 128 | Hashing is deliberately slow, so an unbounded input is CPU exhaustion on an unauthenticated endpoint |
| `autoSignIn` | `false` | With verification required the account cannot be used yet; a session would go to an address nobody has proved they can read |
| `resetPasswordTokenExpiresIn` | 3600 | A reset link is a bearer credential for the account |
| `emailVerification.sendOnSignUp` | `true` | Otherwise the account exists, the flag is false, and nothing that could clear it is ever dispatched |
| `autoSignInAfterVerification` | `false` | Verifying proves the mailbox was reachable, not that the person reading it is at that browser |

`sendChangeEmailConfirmation` is delivered to `user.email` — the address being moved *away from*.
Better Auth hands the new address to the same callback and it is deliberately unused: confirming at
the destination means a session someone else is holding can move the account to an address its
owner cannot reach.

## Account linking

`trustedProviders: ["google"]`. Google asserts a verified address, so a Google sign-in matching an
existing account is the same person, and linking is the right answer — the alternative is a dead end
where a real user is told the email is taken by themselves. Untrusted providers still require an
explicit link from the settings page.

`requireLocalEmailVerified` defaults to `true` and is deliberately left alone: it is what stops
someone pre-registering an unverified account at a victim's address and having the victim's Google
identity linked into it. See [`social-login.md`](./social-login.md).

`socialProviders` is absent rather than half-configured when no credentials were supplied. An empty
client id is rejected at Google's consent screen, which is a failure the user sees and nobody can
diagnose from a log line here — and its absence is what lets the sign-in page decide whether to
render the button at all. `prompt: "select_account"` stops Google silently reusing whichever account
the browser is already signed into.

## Model naming and ids

`modelName` is what the Drizzle adapter looks up in the schema object, so those five names *are* the
export names in
[`packages/infrastructure/src/pg/schema/auth.schema.ts`](../../../infrastructure/src/pg/schema/auth.schema.ts).
They are renamed to this repository's plural convention — `users` beside `organizations`, `roles`,
`memberships` — rather than Better Auth's singular defaults. Field names need no mapping: Better
Auth's are already camelCase, which is the convention here too.

`advanced.database.generateId` returns `Uuid.v7()`. Better Auth's default is an opaque string, which
is what forced `user_id` to be `text` on the domain tables; with time-ordered uuids, `UserId` —
declared `z.uuid().brand<"UserId">()` in `contracts` — is finally true rather than aspirational.

Two additional user fields are worth naming:

- **`locale`** sits on the user rather than a preferences table because it is read on the first
  server render of every request, before anything else about the user is needed.
- **`deactivatedAt`** is a state, not a delete: the activity log still points at this row and always
  will. `input: false` keeps it off every registration payload.
- **`lastActiveOrganizationId`** is written by the organization plugin through
  `internalAdapter.updateUser`, which is why it must be declared here and not only in the Drizzle
  schema.

`cookiePrefix: "app"` is user-visible in the browser and kept generic rather than named after the
project: changing it later invalidates every cookie already issued.

## Two-factor options

`issuer` defaults to `appName` already and is stated so the coupling is visible at the line that
depends on it. `backupCodeOptions` is ten single-use codes of ten characters — the recovery path for
a lost phone, and the reason enabling 2FA cannot lock someone out. `otpOptions.period` is **minutes,
not seconds**; Better Auth's default is 3, and five is a compromise with mail delivery latency.
Anything much longer widens the window in which a forwarded message is still a valid second factor.
See [`two-factor.md`](./two-factor.md).
