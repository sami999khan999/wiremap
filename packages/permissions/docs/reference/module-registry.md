---
title: module-registry
description: ModuleRegistry — nav gates as a second registry, why content may name a module but never a permission, and the gate barrel missing from the build doc.
---

# `ModuleRegistry`

The permission catalog answers "may this actor do X." The module registry answers "should this actor
see the finance section at all," which is a different question with a different owner.

**The two module vocabularies are not the same set, and that is deliberate.**
`PermissionMeta.module` groups the catalog — it is the first segment of every key, by the grammar
`<module>.<subject>.<action>`, and `EffectivePermissionsInspector` renders one section per value.
`ModuleKey` is `keyof typeof GATES`: the modules something navigates to. `apikey` is a grouping
module with no gate, the same way `accountRoutes` declares routes with no gate — nothing links to
API keys yet.

They drifted once, in the direction that is hard to see: `member.*` and `apikey.*` declared
`module: "rbac"` while opening with their own name, so `byModule("member")` answered nothing about
a module that has a gate, and the inspector filed five keys under a heading they do not belong to.
A spec now asserts that every key opens with the module it declares.

```ts
export interface ModuleGate {
  readonly permission: PermissionKey;
  readonly route: AppRoute;
}

export type ModuleKey = keyof typeof GATES;

export class ModuleRegistry {
  public static readonly instance: ModuleRegistry;

  public gate(module: ModuleKey): ModuleGate;
  public isVisible(module: ModuleKey, caps: CapabilitySet): boolean;
  public visibleModules(caps: CapabilitySet): readonly ModuleKey[];
}
```

```ts
ModuleRegistry.instance.visibleModules(caps);        // ["member"]
ModuleRegistry.instance.gate("rbac").route;          // "/settings/roles"
```

---

## Why this is a separate registry

`@loadbearing/content` owns the navigation menu — its labels, order, and icons — and a content editor
may change all three. What an editor must **not** be able to change is which permission gates a
module, or where its route points.

So `nav.data.ts` in `content` carries `module: "finance"`, never
`permission: "finance.read.global"`, and `ModuleRegistry` maps that key to its gate. `content` may
import `ModuleKey` as a type and must never reference `PermissionKey` at all.

That rule is enforced, not merely documented — `tooling/eslint-config/src/index.js` bans the two
identifiers by name for that package alone:

```js
{
  files: ["packages/content/src/**/*.ts"],
  rules: {
    "no-restricted-imports": ["error", {
      paths: [{
        name: "@loadbearing/permissions",
        importNames: ["PermissionKey", "PermissionRegistry"],
        message: "Content names a module. ModuleRegistry owns which permission gates it.",
      }],
    }],
  },
}
```

> [!WARNING]
> That rule is the **core** `no-restricted-imports`, which has no `allowTypeImports` option and
> therefore flags `import type` as well. Since `content` is only ever meant to import `ModuleKey`,
> that is not currently a problem — but it will be the moment anyone reaches for a type-only
> exception. See [20](../../../../docs/setup/20-content-package.md).

Folding the gate onto `PermissionMeta` would collapse the two registries into one and put the
gating decision inside the file a content editor edits. The separation is the whole point.

---

## `src/gate/index.ts` was missing from the build doc

[08](../../../../docs/setup/08-permissions-package.md) shows the file in its tree listing and
`module-registry.ts` imports `GATES` from it, but the doc never writes it out. It mirrors the catalog
barrel exactly:

```ts
import { rbacGates } from "./rbac.gate.js";

export const GATES = {
  ...rbacGates,
  // ...taskGates,
} as const;
```

The same paper cycle applies as in the catalog: `gate/rbac.gate.ts` imports `ModuleGate` from
`../module-registry.js` while `module-registry.ts` imports `GATES` from `./gate/index.js`. The
fragment's import is `import type`, so nothing survives to run.

And the same typo-safety follows from `as const satisfies Record<string, ModuleGate>` — verified:

```ts
ModuleRegistry.instance.gate("finance");
// TS2345: Argument of type '"finance"' is not assignable to
//         parameter of type '"rbac" | "member"'.
```

`satisfies ModuleGate` also type-checks each gate's `permission` against `PermissionKey`, so a gate
pointing at a permission that does not exist fails to compile — and since `route` is `AppRoute` from
[the route table](routes.md) rather than `string`, the same holds for a gate pointing at a path that
does not exist:

```ts
rbac: { permission: "rbac.role.read", route: "/settings/rolez" },
// TS2820: Type '"/settings/rolez"' is not assignable to type 'AppRoute'.
//         Did you mean '"/settings/roles"'?
```

---

## `visibleModules()` is a filter, not a policy

It delegates every decision to `CapabilitySet.can()`, so all five resolution rules apply unchanged —
including a wildcard holder losing a module they have been explicitly denied:

```ts
const caps = CapabilitySet.from({
  wildcard: true,
  org: { grants: [], denies: ["rbac.role.read"] },
  goals: {},
});

ModuleRegistry.instance.visibleModules(caps); // ["member"] — not both
```

Gates are asked without a `goalId`, so a module gated on a goal-scoped permission is never visible —
to anyone, ever, with nothing to indicate why. Gate modules on org-scoped keys, and note this is a
**checked** claim rather than a documented one:

```ts
it("gates every module on an org-scoped permission", () => {
  for (const [module, gate] of Object.entries(GATES)) {
    expect(PermissionRegistry.instance.scopeOf(gate.permission), module).toBe("org");
  }
});
```

Same shape as the `ProcedurePermissions` coverage test in
[10](../../../../docs/setup/10-contracts-package.md) — a cross-check the type system cannot express.

---

## See also

- [`@loadbearing/permissions`](../index.md)
- [CapabilitySet](capability-set.md) — every decision here delegates to `can()`
- [PermissionRegistry](permission-registry.md) — the vocabulary a gate points into
- [ROUTES](routes.md) — the destination table a gate's `route` points into
- [20 · content](../../../../docs/setup/20-content-package.md) — the package this registry exists to constrain
