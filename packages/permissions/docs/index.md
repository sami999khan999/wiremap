---
title: "@loadbearing/permissions"
description: The shared authorization kernel — one permission vocabulary, one resolution algorithm, one nav-gate map, running identically on server, browser, worker, and desktop.
---

# `@loadbearing/permissions`

The architecture's strongest claim is that there is no hardcoded role check anywhere and no second
security model to keep in sync. That claim survives contact with reality only if the vocabulary,
the resolution algorithm, and the scope rules are **one artifact** every runtime loads — the oRPC
handler, React route guards, the `<Can>` component, the worker, and the Tauri shell.

So this package has no database, no HTTP, no React, and no Node built-ins. It is pure data plus one
algorithm, and it loads anywhere.

| | |
| --- | --- |
| **Package** | `@loadbearing/permissions` (private, never published) |
| **Entrypoint** | `src/index.ts` |
| **Depends on** | — nothing at runtime |
| **Used by** | `contracts`, `application`, `infrastructure`, `auth`, `api-client`, `query`, `ui`, `feature`, `content` (type-only), `apps/*` |
| **Environment** | isomorphic — server, browser, worker, and Tauri webview |
| **Build** | `tsup` → `dist/index.js` + `dist/index.d.ts` |

```
packages/permissions/
├── vitest.config.ts
├── src/
│   ├── index.ts                     ← the public barrel; names only folder barrels
│   ├── registry/                    ← no import.ts: this package takes nothing from outside
│   │   ├── index.ts
│   │   ├── permission-registry.ts   → PermissionRegistry, PermissionKey, PermissionMeta, PermissionScope
│   │   ├── module-registry.ts       → ModuleRegistry, ModuleKey, ModuleGate
│   │   ├── flag-registry.ts         → FlagRegistry, FlagKey, FlagMeta
│   │   └── widget-registry.ts       → WidgetRegistry, WidgetKey, ZoneKey, ZONES, WidgetVisibility, …
│   ├── capability/
│   │   ├── index.ts
│   │   ├── capability-set.ts        → CapabilitySet, CapabilitySetDto, ScopedSetDto
│   │   └── entitlement-mask.ts      → EntitlementMask, EntitlementInput
│   ├── catalog/                     ← one fragment per slice, team-owned
│   │   ├── index.ts                 ←   merges fragments (platform-owned)
│   │   ├── core.permissions.ts      ←   held by every principal (rule 5)
│   │   ├── platform.permissions.ts  ←   above the tenant; never in a tenant role
│   │   ├── rbac.permissions.ts
│   │   ├── member.permissions.ts
│   │   ├── apikey.permissions.ts
│   │   └── ai.permissions.ts
│   ├── gate/                        ← same pattern for nav gates
│   │   ├── index.ts
│   │   └── rbac.gate.ts
│   ├── flag/                        ← same pattern for feature flags
│   │   ├── index.ts                 → FLAGS
│   │   └── widget.flags.ts
│   ├── widget/                      ← same pattern for widgets
│   │   ├── index.ts                 → WIDGETS
│   │   ├── core.widgets.ts          ←   the nav: required, ungated
│   │   ├── member.widgets.ts
│   │   └── notification.widgets.ts  ←   the bell: inline
│   └── route/                       ← same pattern for destinations
│       ├── index.ts                 → ROUTES, AppRoute, RoutePath
│       ├── shell.routes.ts          ←   platform-owned: home, sign-in, forbidden
│       ├── rbac.routes.ts
│       ├── account.routes.ts        ←   no gate: your own password is not a capability
│       └── organization.routes.ts   ←   no gate: founding your own tenant is not either
└── tests/
    ├── registry/
    │   ├── permission-registry.spec.ts
    │   ├── module-registry.spec.ts
    │   ├── flag-registry.spec.ts
    │   └── widget-registry.spec.ts
    ├── capability/
    │   ├── capability-set.spec.ts
    │   └── entitlement-mask.spec.ts
    └── route/
        └── route.spec.ts
```

---

## The seams

Beside the seams below, the barrel exports the raw tables the registries wrap — `CATALOG`, `GATES`,
`FLAGS` and `WIDGETS` — because the registries' own specs and `content`'s `ModuleKey` read them
directly.

### [`PermissionRegistry`](reference/permission-registry.md) — the vocabulary

```ts
PermissionRegistry.instance.isKnown(rowFromDatabase); // type predicate
PermissionRegistry.instance.scopeOf("member.read");   // "org" | "goal"
```

A frozen catalog of keys, each carrying its scope, module, and label. `isKnown()` is the boundary
between untrusted text and the typed vocabulary — every role grant, per-user override, and API-key
scope arrives from the database as a raw string and must pass it first.

### [`CapabilitySet`](reference/capability-set.md) — the algorithm

```ts
caps.can("member.deactivate");           // org-scoped
caps.can("task.update", goalId);         // goal-scoped
caps.goalsWith("task.update", ids);      // which of `ids`, resolved by permission
caps.intersect(issuerCaps);              // an API key can never exceed its issuer
CapabilitySet.from(caps.toJSON());       // server → SSR payload → browser, same class
```

Deny by default, explicit deny beats every grant including the wildcard, and a goal-scoped
permission asked without a `goalId` is `false` rather than a throw. Four rules, one implementation,
four runtimes.

### [The platform scope](reference/platform-scope.md) — above the tenant

```ts
caps.can("platform.retention.manage");   // the third axis, and only the third axis
```

A tenant's wildcard does not reach it, the `core` exception does not apply to it, an API key's
`intersect` empties it, and `owner: "all"` excludes it at seed time. Four leak paths, one branch
in `can()`, four cases in the spec.

### [`ModuleRegistry`](reference/module-registry.md) — the nav gates

```ts
ModuleRegistry.instance.visibleModules(caps); // readonly ModuleKey[]
```

"May this actor do X" and "should this actor see the finance section at all" are different
questions with different owners. `@loadbearing/content` owns the menu's labels, order, and icons —
and must never be able to change which permission gates a module. That separation is why this is a
second registry rather than a field on the first.

### [`ROUTES`](reference/routes.md) — the destinations

```ts
ROUTES.rbac.roles;                            // "/settings/roles"
```

One hand-written table of every destination the product has, which `GATES` points into and every
shell links against. It lives here rather than in a shell because a router's generated route tree
cannot be the source — a Nest process has none at all, and web, desktop, and Next each generate a
different one. `ModuleGate.route` is typed `AppRoute`, so a gate naming an undeclared path fails to
compile.

### [`EntitlementMask`](reference/entitlement-mask.md) — what the org's plan allows

```ts
EntitlementMask.from({ plan: "all", added, removed, disabledModules }).narrow(dto);
```

A filter over the grants an org's roles hold, applied before `CapabilitySet.from`. It narrows
grants and never touches a deny, a `core` key or the platform axis. So every check downstream obeys
a plan without knowing plans exist, and an upgrade restores the org admin's roles at once, because
nothing was deleted.

### [`FlagRegistry`](reference/flag-registry.md) — what is switched on

```ts
FlagRegistry.instance.clientGating();   // the flags a widget names — the only ones sent to a browser
```

Every flag is declared in code with an owner and an expiry date, and switched in Postgres.
Client-gating is derived from the widgets, never declared, so a server-only flag's name cannot
reach the session payload by someone forgetting a field.

### [`WidgetRegistry`](reference/widget-registry.md) — what a screen shows

```ts
WidgetRegistry.instance.visibilityOf("member.count", facts); // "visible" | "denied" | …
```

Every card and inline element that can be absent for its own reason, with its zone, its order, its
permission and its policy. `visibilityOf` answers with the broadest cause, as pure data, so a zone
resolves during SSR and a spec can say what a role sees without rendering anything.

---

## Fragmented from day one

One `CATALOG` object works until three teams edit it in the same sprint and every pull request
conflicts. Both registries merge team-owned fragments in a platform-owned barrel:

```ts
// src/catalog/index.ts — changes only when a module is added
export const CATALOG = {
  ...rbacPermissions,
  // ...taskPermissions,
} as const;
```

The literal-union type survives the spread, so typo-safety is unaffected — verified:

```ts
caps.can("rbac.role.reed");
// TS2820: Did you mean '"rbac.role.read"'?
```

> [!IMPORTANT]
> **A permission key is never deleted, only stopped being granted.** Deleting a key makes
> `isKnown()` start rejecting rows that already exist in `role_permissions` — correct behaviour, and
> a confusing way to discover the change. Remove the grants in a migration first, the key in a later
> release.

### The key format

```
<module>.<subject>.<action>[.<qualifier>]
```

Lowercase, dot-separated, no plurals. The `.self` qualifier means "the same action, but only on rows
you own" — the entity decides what "own" means, so `task.update` and `task.update.self` are two
keys, not one key with a flag.

---

## Five places the doc's listing was wrong

Every one of these is proven by a failing test in this package rather than argued from reading. See
the reference pages for the mechanism in each case.

| # | Defect | Where |
| --- | --- | --- |
| 1 | `isKnown` used `value in CATALOG`, so `"toString"` and `"constructor"` passed the untrusted-input boundary | [permission-registry](reference/permission-registry.md#why-objecthasown-and-not-in) |
| 2 | `intersect()` kept only `this`'s denies, so two wildcard sets granted what one explicitly refused | [capability-set](reference/capability-set.md#intersect-is-a-security-boundary) |
| 3 | `intersect()` iterated only `this`'s goals, discarding a deny inside a goal it had not heard of | [capability-set](reference/capability-set.md#intersect-is-a-security-boundary) |
| 4 | `intersect()` filtered org grants through `can()`, dropping org-level grants of goal-scoped keys | [capability-set](reference/capability-set.md#intersect-is-a-security-boundary) |
| 5 | `intersect()` filtered only `this`'s grants, so a wildcard set intersected down to nothing | [capability-set](reference/capability-set.md#intersect-is-a-security-boundary) |

`src/gate/index.ts` was also missing from the listing entirely, though `module-registry.ts` imports
`GATES` from it.

---

## Testing

Tests live in this package's `tests/` directory, named `<subject>.spec.ts` and mirroring the `src/`
tree — `src/capability-set.ts` is covered by `tests/capability-set.spec.ts`. `vitest.config.ts`
narrows `include` to `tests/**/*.spec.ts` so the runner never picks up compiled output from
`dist/`, and `tsconfig.json` includes `tests/**` so `pnpm typecheck` still covers the specs.

```bash
pnpm --filter @loadbearing/permissions test
```

Every key the shipped catalog defines is org-scoped, so the goal-scoped branch of `can()` is
unreachable through it. `capability-set.spec.ts` stubs `PermissionRegistry.instance.scopeOf` to
reach that branch rather than leaving rule 3 unverified until a slice adds a goal-scoped key.

---

## See also

- [PermissionRegistry](reference/permission-registry.md) · [CapabilitySet](reference/capability-set.md) · [The platform scope](reference/platform-scope.md) · [ModuleRegistry](reference/module-registry.md) · [ROUTES](reference/routes.md) · [EntitlementMask](reference/entitlement-mask.md) · [FlagRegistry](reference/flag-registry.md) · [WidgetRegistry](reference/widget-registry.md)
- [Visibility](../../../docs/opinions/visibility.md) — the four mechanisms and the order they resolve in
- [Build order · 08 · permissions](../../../docs/setup/08-permissions-package.md)
- [`@loadbearing/core`](../../core/docs/index.md) — the layer below
