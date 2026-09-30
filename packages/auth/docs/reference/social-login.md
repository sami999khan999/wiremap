---
title: Google sign-in
description: Why the provider is absent rather than half-configured, what makes auto-linking safe here and an account-takeover path elsewhere, and how a server-only flag reaches a button in the browser.
---

# Google sign-in

```ts
socialProviders: config.google
  ? { google: { ...config.google, prompt: "select_account" } }
  : {},
```

## Absent, never half-configured

`apps/web` builds the `google` block only when **both** `GOOGLE_CLIENT_ID` and
`GOOGLE_CLIENT_SECRET` are present — the same shape the `analytics.clickhouse` block already uses.

A half-filled pair does not fail here. It fails at Google's consent screen, as an error page the
user sees and nobody can diagnose from anything this application logs. Absence is also what lets the
sign-in page decide whether to render a button at all, so an unconfigured deployment shows no
Google option rather than one that leads nowhere.

The authorised redirect URI on the Google Cloud client must be `${AUTH_URL}/api/auth/callback/google`.
Better Auth owns that path; nothing in `apps/web/src/route/` routes it.

## `prompt: "select_account"`

Without it, Google silently reuses whichever account the browser is already signed into. On a shared
machine that makes signing in as somebody else impossible, and it reads as a bug in this application
rather than in the consent screen.

## Account linking, and why Google is trusted

```ts
account: {
  modelName: "accounts",
  accountLinking: { enabled: true, trustedProviders: ["google"] },
}
```

A Google sign-in whose email matches an existing account is **linked to it**. The alternative is a
dead end where a real user is told their email is taken — by themselves — with no way forward that
does not involve a support ticket.

This is safe because Google asserts a verified address. It would not be safe for a provider that
does not, which is why `trustedProviders` names one provider rather than being switched on globally:
an untrusted provider that lets anyone claim any email is an account-takeover path, and the trusted
list is where that distinction is made.

**`requireLocalEmailVerified` defaults to `true` and is deliberately never set.** It is what stops
somebody pre-registering an unverified account at a victim's address and having the victim's Google
identity linked into the attacker-owned row on first sign-in. `auth.factory.spec.ts` asserts it is
still undefined, so switching it off is a decision somebody has to make on purpose.

`allowDifferentEmails` is likewise left at `false`. Linking an account with an address that does not
match is a manual takeover path with a friendly name.

## No new tables

`accounts` already carried the full OAuth column set — `accessToken`, `refreshToken`, `idToken`,
both expiry columns and `scope` — beside the `password` column the credential provider uses. Adding
Google needed no migration. A linked account is a second row in `accounts` for one `users` row, and
`providerId` is what tells them apart: `credential` for email and password, `google` for Google.

That is also why unlinking has to **count** rather than filter. `LinkedAccountList` hides the unlink
control when only one row is left, because removing the last credential is how someone locks
themselves out of their own account in one click. Better Auth's `allowUnlinkingAll` stays `false` as
the backstop; the client half is the one that can explain itself.

## Telling the browser whether Google exists

`Env` is server-only, and doc 24 §24.2 records what happened the last time a route component read it
for one accessor: the whole server configuration surface shipped in the browser bundle and
`Schema.parse({})` threw before the first render.

So `googleEnabled` rides the session snapshot. `session.fn.ts` resolves it, `__root.tsx`'s
`beforeLoad` already awaits that payload on every request, and the router context carries it to
every route beneath. No second server function and no extra round trip to answer a boolean that
never changes.

`GOOGLE_CLIENT_SECRET` is on the `ENV_FINGERPRINTS` list in `check-architecture.mjs` §8 — its
appearance anywhere in the client bundle means that boundary was crossed.

## Tenancy still applies

A Google sign-up passes through `session.create.before` exactly like an email one, so it is enrolled
by whichever `MembershipEnroller` the deployment configured and refused a session if it gets no
membership. Nothing about OAuth bypasses the tenancy gate — see
[`enrolment.md`](./enrolment.md).

## Related

- [`enrolment.md`](./enrolment.md) — what happens to the account after Google hands it back.
- `docs/setup/16-auth-package.md` §16.7 — the four surfaces, one `Principal`.
