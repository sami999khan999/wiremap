---
title: The platform scope
description: A third axis above the tenant — the four leak paths it closes, why the tier is an organization, and why the first admin comes from a script rather than the API.
---

# `platform`, the third scope

`PermissionScope` is `"org" | "goal" | "platform"`. The first two are inside a tenant. The third is
above every tenant, and it is the only one a tenant owner cannot reach.

## The tier is an organization

`organizations.is_platform` marks it, a partial unique index guarantees at most one, and
`pnpm db:seed` marks the `loadbearing` organization it already creates. Platform permissions are
then held the way every permission in this system is held — **through a membership and a role** —
and resolved per user, once, and merged into every principal that user gets in any tenant.

A platform admin switched to a customer tenant is still a platform admin. That is the whole
consequence of resolving the axis per user rather than per session.

What this buys, and why it is not an env list of admin emails:

- Removing someone's platform rights is deactivating a membership, which the existing members
  screen already does and the existing audit trail already records.
- A per-user deny works unchanged: `permission_overrides` in the tier, `effect = 'deny'`.
- A second platform role — read-only, say — is a role, not a code change.
- Nothing has to redeploy to change who is an admin.

## The four leak paths, and what closes each

A third scope bolted onto a two-scope `can()` leaks in four places. Each is a case in
`capability-set.spec.ts` that fails the moment the branch is removed.

```ts
if (scope === "platform") {
  if (this.platformSet.deniesPermission(permission)) return false;
  return this.platformSet.grantsPermission(permission);
}
```

Every line of that is load-bearing:

1. **A tenant's `wildcard`.** Nothing in production sets it: both resolutions in
   `PgCapabilityRepository` and the API-key resolver write `false`, and an `owner` holds every
   tenant key as an explicit row. The flag is still on the DTO, and if anything ever set it,
   falling through to `allowsAtOrg` would make that principal a platform admin in every tenant.
   **A platform admin is never given it either.** It would make them an owner inside every
   customer tenant, and a platform admin holds no tenant powers.
2. **An org-level grant of the same key.** The branch consults `platformSet` and nothing else, so a
   `platform.*` string that reached `org.grants` grants nothing.
3. **`intersect()`.** An API key is issued by a user who may be a platform admin. `intersect` sets
   `platform` to **empty** rather than intersecting it: a key that could act as one would be a
   platform admin nobody can revoke by removing a membership.
4. **The `core` exception.** `isCore` is not consulted. A platform key that landed in a core module
   would otherwise be held by every principal in the system, resolved or not.

Two more things fall out of the same branch and are worth stating:

- **`owner: "all"` stops at the tenant.** `SystemRoleSeed` resolves `"all"` as the catalog minus
  the platform scope, and its `reconcile()` takes back any platform key an earlier deploy handed
  out.
- **The role editor offers no platform checkbox** in a customer tenant. `PermissionMatrix` takes
  `excludeScopes`, by scope and never by module name. That removes the checkbox; the grant
  use-case's no-escalation rule is what actually refuses the write.

## The DTO's third axis is optional, on purpose

`CapabilitySetDto.platform` is `ScopedSetDto | undefined`, and `from()` reads a missing axis as
empty. A DTO cached in Redis or serialised into an SSR payload before this axis existed comes back
without it; degrading to "no platform rights" is the safe reading, and a required field would
throw on every request behind it until the cache expired.

## The first admin comes from a script

`GrantPermissionUseCase` refuses a key the granter does not hold. That is the right rule, and it
means **nobody can grant the first `platform.*` key through the API** — there is no one holding it
to grant it.

```bash
pnpm platform:grant alice@example.test
```

One membership in the platform organization, under `platform_admin`. Every later admin is invited
through the existing members screen with the platform organization active.

## A suspended account, and the way back

`users.suspended_at` is the platform's lock on an account in every tenant at once, set from
`/platform/accounts` with `platform.account.manage`. A suspended platform admin holds nothing, the
tier included, because every membership read answers no for them.

Two guards stop the tier locking itself out. Neither a suspend nor a platform deny that reaches
`platform.account.manage` may take it from its last live holder, and nobody may suspend
themselves. What those miss — two admins suspending each other in the same second — is why
`platform:grant` refuses a suspended account and prints the way back:

```bash
pnpm platform:grant alice@example.test
# alice@example.test is suspended by the platform (since …).
# Reinstate them at /platform/accounts. With no platform admin left to do that, by hand:
#   UPDATE users SET suspended_at = NULL WHERE email = 'alice@example.test';
```

A reinstate by hand writes no audit row. The script does not do it for you, so that the one
unaudited change is one somebody typed on purpose.

## Where the axis is resolved, cached and flushed

`PgCapabilityRepository.resolvePlatformFor(userId)` is two queries against the organization marked
`is_platform`, filtered to keys the registry calls platform-scoped. `CapabilityCache.platformFor`
caches it under `capability:platform:<userId>` for sixty seconds — its own prefix, because the
answer is keyed on the user alone.

Flushing is the adapter's job rather than each use-case's. `CapabilityCache.invalidate` and
`invalidateOrganization` both also flush the platform prefix **when the organization they were
given is the tier**, which is the only place that knows which one it is. A role edit in a customer
tenant therefore cannot change a platform grant, and one in the tier always does.

`PrincipalBuilder.fromHeaders` reads both sets in parallel and merges them; `session.fn.ts` runs
the same merge, so client `can()` and server `assert()` answer off one set. The API-key path and
both system principals carry an empty platform axis.

## Adding a platform key

1. A line in `catalog/platform.permissions.ts`, `scope: "platform"`, `module: "platform"`.
2. `PlatformRoleSeed` grants it to `platform_admin` on the next `pnpm db:seed` — it resolves
   `byScope("platform")` at seed time rather than from a list.
3. Its procedure, its `catalog/platform.permissions.ts` entry in `contracts`, and its router
   handler, in one commit.

Until step 3, the key is in `PERMISSION_AWAITING_A_PROCEDURE` in
[`check-architecture.mjs`](../../../../tooling/scripts/check-architecture.mjs) §28 — a key nothing
asserts grants nothing, and that list only ever shrinks. It has been empty since `24.2`.
