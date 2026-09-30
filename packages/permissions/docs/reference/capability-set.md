---
title: capability-set
description: CapabilitySet — deny-by-default permission resolution, the five rules, and why intersect() is the method an RBAC model gets quietly defeated through.
---

# `CapabilitySet`

Resolved capabilities for one principal — a user or an API key, same shape.

```ts
export class CapabilitySet {
  public static from(dto: CapabilitySetDto): CapabilitySet;   // filters unknown keys
  public static empty(): CapabilitySet;

  public can(permission: PermissionKey, goalId?: string): boolean;
  public canAll(permissions: readonly PermissionKey[], goalId?: string): boolean;
  public canAny(permissions: readonly PermissionKey[], goalId?: string): boolean;
  public canTenantWide(permission: PermissionKey): boolean;   // held in every goal at once
  public goalsWith(permission: PermissionKey, amongGoalIds: readonly string[]): readonly string[];
  public intersect(other: CapabilitySet): CapabilitySet;
  public toJSON(): CapabilitySetDto;
}
```

---

## The five resolution rules

1. **Deny by default.** Absence of a grant is a denial. There is no "allow unless denied" path —
   except the one named in rule 5, which is a closed module rather than a path.
2. **Explicit deny beats every grant**, including the wildcard. This is what makes a per-user
   override usable as a suspension mechanism without unpicking role assignments.
3. **A goal-scoped permission with no `goalId` is `false`.** Not an error, not a throw — `false`.
   Forgetting the scope fails closed.
4. **Wildcard is checked after denies.** A superuser explicitly denied one permission is denied it.
5. **Every `core.*` permission is held by any resolved principal**, checked in the same place the
   wildcard is — after denies, so rule 2 is still the rule nothing is above.

```ts
CapabilitySet.empty().can("rbac.role.read");   // false — rule 1

const caps = CapabilitySet.from({
  wildcard: true,
  org: { grants: [], denies: ["rbac.role.manage"] },
  goals: {},
});
caps.can("rbac.role.manage");                  // false — rules 2 and 4
caps.can("rbac.role.read");                    // true
```

A goal-level deny is checked before the org-level grant that would otherwise cover it, so a
principal can hold a permission org-wide and be denied it in exactly one goal.

### Why the `core` module is exempt

```ts
CapabilitySet.empty().can("core.activity.write");   // true — rule 5
```

`core.activity.write` describes acting at all: every principal that reaches a use-case writes an
audit row, so the question "may this principal write one?" has no answer other than yes. Granting it
through a role makes that a decision somebody can get wrong, and somebody did — only `owner`'s
wildcard carried it, `IndexDocumentUseCase` asserted it and the member use-cases deliberately did
not, so whether an audit row could be written depended on which use-case you were in.

The exemption is a lookup against `PermissionMeta.module`, never a string prefix: a key named
`core.something` in another module is not exempt, and a `core` key renamed stays exempt. It is
checked **after** denies and beside the wildcard, so an operator can still suspend it the same way
they suspend anything else — and `intersect()` needs no special case, because the rule lives in
`can()` rather than in the DTO the narrowing operates on.

The alternative — `PgCapabilityRepository.resolveFor` adding the keys to every row it returns —
puts the rule in the store rather than in the resolver, where the SSR payload and the Redis cache
would each have to carry it too.

---

## `toJSON()` / `from()` is why one class serves four runtimes

The DTO is plain JSON. The server resolves a set from the database, serialises it into the SSR
payload, and the browser reconstructs the identical class. The `<Can>` component and the oRPC
handler then run the *same* `can()` — not two implementations that agree today. The worker and the
desktop app do the same.

```ts
const revived = CapabilitySet.from(JSON.parse(payload) as CapabilitySetDto);
```

> [!IMPORTANT]
> The round-trip test in `capability-set.spec.ts` is the one that protects the architecture. If it
> ever fails, the server and the browser have stopped agreeing about permissions.

The `as CapabilitySetDto` is required, not decorative: `JSON.parse` returns `any`, and
`@typescript-eslint/no-unsafe-argument` — on via `recommendedTypeChecked` — rejects passing it
straight into `from()`.

---

## `goalsWith()` does more work than it looks

```ts
caps.goalsWith("task.update", candidateGoalIds); // readonly string[]
```

Escalation that resolves targets *by permission rather than by role* is this method. "A manager sees
capacity only within their own goals" is this method. Per-recipient digest filtering is this method.
Writing it once, on the class that owns the data, is what makes "no hardcoded role checks" true
rather than aspirational — the alternative is `WHERE role = 'manager'` in three query files that
drift apart.

### Why the candidate set is a parameter

This object cannot produce it. It knows only the goals its own DTO names, and two principal shapes
hold a goal-scoped permission in goals that never appear there — a wildcard holder, and anyone
granted the permission at org level, since an org grant covers every goal.

Filtering its own `goals` keys answered `[]` for both while `can()` answered `true`. That gap fed an
empty permitted scope into `VectorStore.search()`, where empty means `isNull(goalId)` — org-wide
chunks only ([14](../../../../docs/setup/14-vector-store.md)). A superuser asking about a project's
documents got no goal-scoped results and **no error**: fail-closed, and silently wrong.

Taking candidates and filtering them through `can()` makes all four shapes correct for free, because
`can()` already handles each one:

| Principal | Result |
| --- | --- |
| wildcard | every candidate |
| org-level grant of a goal-scoped permission | every candidate |
| per-goal grants | only the granted ones |
| per-goal deny | excluded, even under wildcard |

It also mirrors `VectorStore.search()` itself, where `goalIds` is required so the permitted scope
cannot be forgotten ([12](../../../../docs/setup/12-application-package.md)). Duplicates in the input
are collapsed; order is the caller's.

---

## `canTenantWide()` is the question a role assignment asks

A role is never assigned inside one goal, so "may this actor hand out that role" is "does the actor
hold every key of it **in every goal at once**". `can()` without a goal answers `false` for a
goal-scoped key by rule 3, which would make every such role unassignable. `canTenantWide()` asks the
org level instead: a deny wins, then the wildcard and `core`, then an org grant. A grant inside one
goal does not count, and a platform key is asked exactly as `can()` asks it.

`RoleRules.assertAssignableBy` is the one caller. It is `CR.1`'s fix: `admin` held `member.invite`
and could invite anyone onto `owner`, because nothing compared what the role grants with what the
actor holds.

---

## `intersect()` is a security boundary

An API key is a principal whose capability set cannot exceed its issuer's. Intersecting at creation
is the obvious half. Re-intersecting **at resolution** is the half that matters: when the issuer's
permission is revoked, every key they created narrows on the *next request* rather than at the next
key rotation. That closes the most common way an RBAC model gets quietly defeated.

Which means the method has to be correct in four ways the original listing was not. All four are
proven by tests in `capability-set.spec.ts` — restore the original body and exactly those tests go
red.

### Denies union, grants intersect

```ts
// key: wildcard, no denies.  issuer: wildcard, denies rbac.role.manage.
key.intersect(issuer).can("rbac.role.manage");
// original: true  ← the key does what its issuer is explicitly refused
// correct:  false
```

Keeping only `this`'s denies means `wildcard && wildcard` survives with an empty deny list, and the
intersection grants strictly more than one of its inputs. A deny on either side has to survive.

### Goal keys union

```ts
// key knows no goals.  issuer denies member.deactivate inside GOAL.
key.intersect(issuer).can("member.deactivate", GOAL);
// original: true  ← iterating this.dto.goals discards the goal entirely
// correct:  false
```

Iterating only `this`'s goals silently drops every restriction the other side expressed about a goal
`this` has never heard of.

### Org candidates are tested at org level

```ts
// member.read granted at org level, treated as goal-scoped.
caps.intersect(caps).can("member.read", GOAL);
// original: false  ← intersect is not even idempotent
// correct:  true
```

An org-level grant of a *goal*-scoped permission is real — it covers every goal. But `can(p)` with
no `goalId` is `false` by rule 3, so filtering org grants through `can()` drops it. `intersect` uses
a private `allowsAtOrg()` instead, which is also the org branch `can()` itself delegates to.

### Both sides' grants are candidates

```ts
// key: wildcard, lists nothing.  issuer: no wildcard, grants member.read.
key.intersect(issuer).can("member.read");
// original: false  ← the intersection is empty
// correct:  true
```

A wildcard set grants everything and lists nothing, so filtering only `this`'s grants intersects it
down to nothing. This is the realistic case, not a contrived one: an issuer who *was* a superuser
created a wildcard key and has since lost superuser. The key must narrow to the issuer's current
explicit grants — not to nothing, and certainly not stay wildcard.

Taking the union of both sides' grants as the candidate set and keeping each key only where both
sides allow it makes the operation a real set intersection, and makes it behave the same whichever
side is narrowed.

---

## `from()` is where the vocabulary boundary holds

A DTO arrives here from three places — the database, a Redis cache entry, and an SSR payload — and
only the first has already been filtered through `isKnown()`. So `from()` re-filters every set, which
is what makes that boundary true on all three paths instead of one:

```ts
CapabilitySet.from({
  wildcard: false,
  org: { grants: ["member.read", "task.archive"], denies: [] },
  goals: {},
}).toJSON().org.grants;                      // ["member.read"] — the unknown key is gone
```

Two details matter. The **sanitised** DTO is what gets stored, not the caller's — `toJSON()` returns it
by reference, so keeping the original would write the dropped keys straight back out to the cache on
the next fill. And a goal key survives even when every permission inside it was dropped, because an
empty goal entry is still meaningful to `intersect()`, which unions goal keys across both sides.

`intersect()` builds through `from()` too, on sets that are already clean. That redundant filter is a
few keys' worth of work, and worth it to keep one entry point rather than a trusted back door.

---

## `ScopedSet` is internal on purpose

`grants` and `denies` are `ReadonlySet`s built once in the constructor, so `can()` is two hash
lookups rather than two array scans. The class is not exported — the DTO is the contract, and
`ScopedSet` is free to change shape.

Note `public constructor(dto: ScopedSetDto)`: Biome's `useConsistentMemberAccessibility` is set to
`explicit`, so a bare `constructor(` is a lint error throughout this codebase.

---

## See also

- [`@loadbearing/permissions`](../index.md)
- [PermissionRegistry](permission-registry.md) — where `scopeOf()` comes from
- [ModuleRegistry](module-registry.md) — the only other consumer of `can()` inside this package
- [16 · auth](../../../../docs/setup/16-auth-package.md) — the API-key resolution path that calls `intersect()`
