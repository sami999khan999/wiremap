---
title: permission-registry
description: PermissionRegistry — the permission vocabulary, the fragmented catalog behind it, and why isKnown() uses Object.hasOwn rather than the `in` operator.
---

# `PermissionRegistry`

The vocabulary. A frozen catalog of keys, each carrying its scope, module, and label.

```ts
export type PermissionScope = "org" | "goal";

export interface PermissionMeta {
  readonly scope: PermissionScope;
  readonly module: string;
  readonly label: string;
}

export type PermissionKey = keyof typeof CATALOG;

export class PermissionRegistry {
  public static readonly instance: PermissionRegistry;

  public all(): readonly PermissionKey[];
  public meta(key: PermissionKey): PermissionMeta | undefined;
  public scopeOf(key: PermissionKey): PermissionScope | undefined;
  public byModule(module: string): readonly PermissionKey[];
  public isKnown(value: string): value is PermissionKey;
  public modules(): readonly string[];
}
```

`instance` is `static readonly`, which satisfies the static-mutable-state ban in
[05](../../../../docs/setup/05-lint-and-format.md). It holds no state; the singleton exists so call
sites read `PermissionRegistry.instance.isKnown(x)` rather than constructing one each time.

---

## Why `Object.hasOwn` and not `in`

`isKnown()` is the boundary between untrusted text and the typed vocabulary. Role grants, per-user
overrides, and API-key scopes all arrive from the database as raw strings, and a stale row must never
grant something the registry no longer defines. Written the obvious way, it does:

```ts
public isKnown(value: string): value is PermissionKey {
  return value in CATALOG;   // ← accepts "toString", "constructor", "valueOf", "hasOwnProperty"
}
```

> [!CAUTION]
> **`in` walks the prototype chain.** `CATALOG` is an object literal, so it inherits from
> `Object.prototype`, and `"constructor" in CATALOG` is `true`. Verified by a failing test.

Follow the consequence through and it is not merely cosmetic. A `role_permissions` row reading
`constructor` passes `isKnown()`, is narrowed to `PermissionKey`, and lands in a `CapabilitySet`'s
grant set. Then:

1. `scopeOf("constructor")` reads `CATALOG["constructor"].scope` — the `Object` constructor has no
   `scope`, so this is `undefined`.
2. `undefined === "goal"` is false, so `can()` takes the org branch.
3. The org branch finds `"constructor"` in the grants set and returns **`true`**.

A permission that does not exist is granted. `Object.hasOwn` checks own properties only and closes
it:

```ts
return Object.hasOwn(CATALOG, value);
```

Reachable only if that string reaches the table — which is precisely the input this method exists to
filter. `all()`, `byModule()`, and `modules()` were never affected: they go through `Object.keys`,
which is own-properties-only already.

### The same input crashed instead of granting

Closing the *grant* path left the *crash* path open. Step 1 above reads `CATALOG[key].scope` blind,
so a key the catalog does not define is a `TypeError` rather than `undefined` — verified:

```
can("task.archive") → TypeError: Cannot read properties of undefined (reading 'scope')
```

The trigger is a deploy, not an attack. Delete a permission from `CATALOG` and `CapabilityCache`
still holds pre-deletion DTOs in Redis for up to its sixty-second TTL — so those users get **500s
instead of 403s** for a minute, and `ModuleRegistry.visibleModules()` takes the whole navigation
down with them.

So `meta()` and `scopeOf()` return `| undefined`, and `can()` treats that as a denial. The type still
says a `PermissionKey` is always defined, and at compile time it is; the optional return is about the
runtime paths the type cannot see — a cast, or a DTO that outlived the key it names.

### Derived views are computed once

`CATALOG` is a compile-time constant, so `all()`, `modules()` and the `byModule()` grouping are built
at module load and returned frozen — `registry.all() === registry.all()`. `visibleModules()` and an
admin permission matrix both call into these per render, and rebuilding an array each time to answer a
question whose answer cannot change is waste.

They are module-level consts rather than `static readonly` members holding a `Map`: the ESLint
architecture rules ban static mutable state, and a `static` field holding a mutable `Map` is the exact
shape that ban exists to catch ([05](../../../../docs/setup/05-lint-and-format.md)).

---

## The catalog is fragmented

One `CATALOG` object works until three teams edit it in the same sprint and every pull request
conflicts. So keys live in team-owned fragments and a platform-owned barrel merges them:

```ts
// src/catalog/rbac.permissions.ts — the only fragment the starter kit ships
export const rbacPermissions = {
  "rbac.role.read": { scope: "org", module: "rbac", label: "View roles" },
  // ...
} as const satisfies Record<string, PermissionMeta>;

// src/catalog/index.ts — changes only when a module is added
export const CATALOG = {
  ...rbacPermissions,
  // ...taskPermissions,
} as const;
```

`as const satisfies Record<string, PermissionMeta>` does two jobs at once: `satisfies` checks each
entry against `PermissionMeta` without widening it, and `as const` keeps the keys as literals so
`keyof typeof CATALOG` is a union of exactly ten strings. Both survive the spread:

```ts
caps.can("rbac.role.reed");
// TS2820: Type '"rbac.role.reed"' is not assignable to ...
//         Did you mean '"rbac.role.read"'?
```

Each team owns one file. Two teams adding permissions in the same week never conflict.

The fragment imports `PermissionMeta` from `../permission-registry.js` while the registry imports
`CATALOG` from `./catalog/index.js`. That is a cycle on paper and not at runtime — the fragment's
import is `import type`, which `verbatimModuleSyntax` erases entirely.

---

## Scope is a property of the permission, not of the check

`goal.create` is org-scoped because you create a goal before it exists. `goal.update` is goal-scoped
because it operates on one. Getting this backwards is the most common modelling error here, and the
symptom is `can()` returning `false` for someone who should obviously have access — because a
goal-scoped permission was asked without a `goalId` and rule 3 failed it closed.

Every key the shipped catalog defines is org-scoped, which is why
[`capability-set.spec.ts`](capability-set.md) stubs `scopeOf` to test the goal branch at all.

---

## `requires` and its mirror

Some keys are useless alone. `member.invite` opens a form whose role picker reads `role.list`, so
a person who can invite and cannot read roles sees an empty picker and a button that fails. A key
names what it needs:

```ts
"member.invite": { …, requires: ["member.read", "rbac.role.read"] },
```

The rule for adding an edge: a write key requires its read key, and a key whose screen reads
another subject requires that subject's read key too. Every requirement is in the same scope as
the key that needs it, and the spec checks both.

| Method | Answers | Used when |
|---|---|---|
| `closure(keys)` | the keys plus everything they need, transitively | an add: a plan, an adjustment, a per-user grant |
| `dependentClosure(keys)` | the keys plus everything that needs them | a remove or a deny, so no key is left held and unusable |

**Closed on write only.** Applying `requires` on read would take access away from existing roles
on the day it deployed: every role holding `member.invite` without `rbac.role.read` would lose the
invite. Closing the set when it is written changes nothing that already exists.

`requires` is typed `readonly string[]`, not `PermissionKey[]`. The fragments `satisfies
PermissionMeta`, and `PermissionKey` is derived from them, so the typed form is a circular type
(TS7022). Each entry is narrowed through `Object.hasOwn(CATALOG, …)` once, at module load.

## Never delete a key

> [!IMPORTANT]
> A permission key is never deleted, only stopped being granted. Deleting one makes `isKnown()` start
> rejecting rows that already exist in `role_permissions` — correct behaviour, and a confusing way to
> discover the change. Remove the grants in a migration first, the key in a later release.

---

## See also

- [`@loadbearing/permissions`](../index.md)
- [CapabilitySet](capability-set.md) — the only caller of `scopeOf()`
- [ModuleRegistry](module-registry.md) — the same fragment pattern for nav gates
- [`@loadbearing/tsconfig` · base](../../../../tooling/tsconfig/docs/reference/base.md) — where `verbatimModuleSyntax` comes from
