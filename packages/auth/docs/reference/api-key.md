---
title: The API-key model
description: Shown once, stored as a digest, looked up by prefix, compared in constant time — and re-intersected with the issuer's live capabilities on every request rather than frozen at creation.
---

# The API-key model

`ApiKeyResolver` turns a token into a `Principal`; `ApiKeyHasher` holds what that needs from a token
and nothing more.

**`ApiKeyRepository` used to be declared here**, on the argument that no use-case should learn API
keys exist. That argument held exactly as long as nothing could issue one. The moment the product
grew a settings page, issuing a key became a domain operation gated on `apikey.manage` — with an
audit row, a scope check and a `UnitOfWork` — so the port moved to `packages/application/src/apikey/`
and `auth` imports it from there. `PgApiKeyRepository` satisfies both halves.

The split that survived is in the *shapes*, not the ports: `ApiKeyRecord` carries `tokenHash` and is
what authentication reads, while `ApiKeySummary` is what a list renders and has no hash field at all.
A digest that cannot be in the type cannot be mapped onto the wire by a careless DTO.

Minting moved with it. `ApiKeyRules` in `application` owns the token format — the `rk_` marker, the
eight-character prefix — because both layers depend on it and two copies drift into a key that
authenticates against nothing.

## The token is shown once and never stored

```ts
const bytes = crypto.getRandomValues(new Uint8Array(32));
const token = `rk_${hex(bytes)}`;
return { token, prefix: token.slice(0, 8), hash: await sha256(token) };
```

`token` is returned to the caller at creation and never written anywhere. The row holds `prefix` and
`tokenHash`, so a database dump contains no usable credential — and "I lost it" is answered by
issuing a new key, not by looking the old one up.

256 bits from a CSPRNG. `crypto` is reached off `globalThis` rather than imported, the same way
`ServerOnly` reaches `window`, because `lib: ["ES2024"]` declares neither.

## The prefix is an index, not an identifier

Eight characters, stored in an indexed column. Without it, authenticating a key is a scan-and-compare
over every key ever issued.

**Several keys share a prefix, and that is fine** — the repository returns *candidates* and the hash
comparison picks one. A resolver that returned the first candidate would authenticate one integration
as another; `tests/apikey/api-key.resolver.spec.ts` pins that it does not.

## `timingSafeEqual` costs nothing here and closes a question

```ts
if (a.length !== b.length) return false;
let diff = 0;
for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
return diff === 0;
```

The prefix already narrowed the candidate set to a handful, so this runs a few times per request over
64-character digests. The length short-circuit is the one leak it accepts, and it never fires: the
values compared are always SHA-256 hex.

It is here less for the attack than for the review — it removes a class of question that would
otherwise have to be answered every time someone reads this file.

## Re-intersection is the part that matters

```ts
const declared = CapabilitySet.from({ wildcard: false, org: { grants: scoped, denies: [] }, goals: {} });
const issuer   = await this.capabilities.forUser(record.organizationId, record.issuerId);
const effective = declared.intersect(issuer);
```

**A key's scopes are re-intersected with the issuer's *live* capabilities on every request, not
frozen at creation.**

With frozen scopes, revoking the issuer's `rbac.role.manage` leaves every key they ever issued still
managing roles — and nobody notices, because the key still works. Re-intersecting means revoking a
person narrows their keys with them, in the same request, through the same
[`CapabilityCache`](capability-cache.md) that gates their browser session.

**And the issuer's membership is checked alongside it**, `MembershipReader.isActive`, in parallel with
the capability read. The session path makes that check and this one did not (`CR.2`), so a
deactivated member's keys kept working — the grants narrowed by the cache's minute, and `core` keys
not at all, because an intersection keeps them on both sides.

The scopes are also filtered through `PermissionRegistry.isKnown()` first. A row written before a
permission was renamed is a stale string, not a grant — and it must not throw either, because a stale
key is a 401, never a 500.

## Revocation and expiry are checked before the key is recorded as used

```ts
if (record.revokedAt) return null;
if (record.expiresAt && record.expiresAt <= now) return null;
…
await this.repository.touch(record.id, now);
```

`touch` records a *successful* use. Recording a refused one would put a last-used timestamp on a
revoked key, which is the field an operator reads when deciding whether a leaked key was ever used.

**And it is throttled, in the predicate rather than in a branch.** Unthrottled, this is one `UPDATE`
per authenticated request forever — a write on the hottest read path in the system, to a column
nothing reads more precisely than "roughly when". The repository takes a `notBefore` and the row is
only rewritten if `last_used_at` is null or older than it; `ApiKeyRules.TOUCH_THROTTLE_MS` sets the
window at five minutes.

## Issuing, listing and revoking

Three use-cases in `application/src/apikey/`, gated on `apikey.read` and `apikey.manage`, behind
`/settings/api-keys`.

**A key cannot be issued with a scope its issuer does not hold.** Re-intersection below already means
such a scope would grant nothing — until the issuer is promoted, at which point the key silently
widens. Refusing at creation is the difference between a key that means what it says and one that
means whatever its issuer means later.

**A key cannot issue a key** (`CR.3`). The child is the *issuer's*, not the parent's, and nothing ties
the two — so a leaked short-lived key holding `apikey.manage` could mint a permanent sibling that
survived its own revocation. `CreateApiKeyUseCase` refuses any `api_key` principal outright: keys are
made by a person, signed in.

**Revocation is a timestamp and the row stays.** A key that authenticated something last week is part
of the audit trail, and a deleted row answers no question about it. Re-revoking is idempotent and
keeps the *first* timestamp, because that is the one an incident review reads.

**The plaintext exists in exactly one response shape**, `ApiKeyContract.created`, returned once. It is
never written to the query cache, never in the list, and never in the audit row — which records the
prefix and the scopes instead.

## What is missing on purpose

**No rate limit per key, and no scope hierarchy.** Better Auth's own rate limiter covers the auth
endpoints; a per-key budget belongs with whatever meters usage, which this kit does not ship. A scope
hierarchy (`rbac.*`) would make the intersection above ambiguous, and the permission catalog is
deliberately flat for the same reason.
