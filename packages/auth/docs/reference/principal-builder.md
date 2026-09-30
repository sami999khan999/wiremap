---
title: PrincipalBuilder
description: Four credential types collapse into one Principal here. Why the API key is checked before the cookie, why a rejected key never falls through to the session, and what the builder deliberately does not do.
---

# `PrincipalBuilder`

Twelve lines, and every one of them is a decision.

```ts
public async fromHeaders(headers: RequestHeaders): Promise<Principal | null> {
  const apiKey = headers.get("x-api-key");
  if (apiKey) return this.apiKeys.resolve(apiKey);

  const session = await this.sessions.resolve(headers);
  if (!session) return null;

  const capabilities = await this.capabilities.forUser(session.organizationId, session.userId);
  return new Principal(session.organizationId, session.userId, capabilities, "user");
}
```

## The API key is checked first, and the order is a security property

A request carrying **both** a cookie and an `x-api-key` is an integration calling through a browser
context. It happens: a dashboard embedded in an admin tool, a support script run from a logged-in
laptop, a webhook replayed from a browser devtools tab.

Checking the session first would resolve that request as the signed-in *user* and silently upgrade a
key scoped to `member.read` to the issuer's full permissions. **The key is the more specific
credential, so it wins**, and the session is never even resolved — so the cookie cannot influence the
answer in any way.

## A rejected key does not fall through

`this.apiKeys.resolve(apiKey)` is `return`ed, not assigned and tested. A revoked, expired or unknown
key produces `null` and the request is unauthenticated — it does **not** continue on to the cookie.

The alternative reads harmlessly and is not: it turns a revoked integration key into a working
request whenever the caller happens to also hold a browser session, which is exactly the caller who
revoked it.

## `null` is a `Principal`-shaped answer, not an error

The builder throws nothing. `principalMiddleware` in `apps/web` turns `null` into an
`UnauthorizedError`, and the worker never calls this at all — it builds a `SystemPrincipal` from a
named grant list. Keeping the decision at the call site is what lets one builder serve a transport
that answers 401 and a process that has no HTTP.

A suspended account is `null` too, and needs no branch here. `MembershipReader.isActive` joins
`users` and answers no once `suspended_at` is set, so a suspend reaches the builder, `refresh`
and an API key's issuer through the one check every path already makes.

## `refresh` re-reads a principal a stream is holding

A request builds its principal and drops it within milliseconds. A stream builds one and holds it
for thirty minutes, and everything that happened in between is invisible to it: a deactivation, a
role edit, a revoked grant. `refresh(principal)` is the read a held stream asks for each minute.

| Kind | What `refresh` does |
|---|---|
| `user` | exactly what `fromHeaders` does after the session: `isActive`, then the tenant and platform sets, merged |
| `api_key` | `isActive` for the issuer, then the old set **intersected** with the issuer's current one |
| `system` | returns it unchanged — the worker never holds a stream |

**An API key only narrows.** Its declared scopes are not in hand, only the principal. Rebuilding
from the issuer alone would widen a key scoped to `member.read` into everything the issuer holds,
which is the upgrade the key-first ordering above exists to prevent. The cost is that a right
restored to the issuer does not come back until the stream reopens, and a reopen is a fresh
`fromHeaders`.

## What it does not do

**It does not authorize.** It produces the actor; `Authorizer.assert()` inside the use-case decides.
A permission check here would be a check the worker skips, since the worker never constructs a
principal this way.

**It does not know about Better Auth.** It holds a `SessionResolver`, which is a port declared in
`application`. That is why a NestJS migration rewrites a guard rather than rewriting authentication,
and why swapping the auth library rewrites `BetterAuthSessionResolver` and nothing else.

**It does not read a tenant from the request.** `ResolvedSession` carries the organization, pinned at
sign-in by the session-create hook. There is no header, no query parameter and no body field a caller
could set that reaches `Principal.organizationId`.

## Tested behaviours

`tests/principal/principal.builder.spec.ts` pins the two orderings above, because both are invisible
in review once they are correct — the file reads the same whichever way round it is. It also pins
`refresh`: a deactivated user or issuer answers `null`, and a key is never widened.
