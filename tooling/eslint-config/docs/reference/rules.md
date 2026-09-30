---
title: rules
description: The blocks in the config — ignores, typed rules, the OOP shape assertions, the two bans that need type-import nuance, and the lazy() ban.
---

# Rules

One config, four blocks. Each is scoped by `files`, which is what replaced the old
`base` / `oop` / `react` preset split.

---

## Block 1 — `ignores`

```js
ignores: [
  "**/dist/**",
  "**/.output/**",
  "**/migrations/**",
  "**/*.config.ts",
  "**/*.config.mts",
  "**/*.d.ts",
];
```

`dist` and `.output` are build artefacts; `migrations` is generated SQL. The other three share
one reason: **those files are not inside any package's tsconfig `include`, so `projectService`
cannot resolve them and a type-aware rule fails with a parsing error rather than a finding.**

> [!IMPORTANT]
> Deliberately `**/*.config.ts`, not `*.config.*`. The wider glob also matches
> `eslint.config.js` itself, which makes an editor report _"File ignored because of a matching
> ignore pattern"_ on every config file you open.
>
> The leading `**/` matters too: flat-config ignore patterns resolve against the config file's
> own directory, so a bare `dist/**` would not match `packages/core/dist/`.

---

## Block 2 — typed rules

```js
files: ["packages/*/src/**/*.{ts,tsx}", "apps/*/src/**/*.{ts,tsx}"],
extends: [...tseslint.configs.recommendedTypeChecked],
languageOptions: { parserOptions: { projectService: true } },
```

`projectService` discovers each file's `tsconfig.json` automatically, so no block hardcodes
project paths and a new package needs no lint configuration at all.

### `no-floating-promises` and `no-misused-promises`

The two rules that justify the cost of type-aware linting — they cannot work without type
information. Every use-case is `async` and every repository call returns a promise, so a
missing `await` on a `.save()` returns `200` while the write is still in flight, or never lands
if the process exits. No unit test catches it and no reviewer reliably spots it.

> Biome ships a type-aware `noFloatingPromises` that does not use `tsc`. If it holds on this
> codebase, deleting these rules and the `recommendedTypeChecked` extend removes most of what
> makes the ESLint pass slow.

### `require-await`

The inverse: an `async` function that never awaits is usually an unfinished signature change.

`ContentSource`'s methods are `async` with nothing to await on purpose, so a CMS can be added
later without changing any call site — but they are `async` methods satisfying an abstract
signature, not free functions, so they do not trip this.

### `parameter-properties`

```js
["error", { prefer: "parameter-property" }];
```

**The single rule with no Biome equivalent in either direction.** Biome has
`noParameterProperties`, which bans the form; nothing requires it.

```ts
// ✗ rejected
class ReactivateTaskUseCase {
  private readonly tasks: TaskRepository;
  constructor(tasks: TaskRepository) {
    this.tasks = tasks;
  }
}

// ✓ required
class ReactivateTaskUseCase {
  constructor(private readonly tasks: TaskRepository) {}
}
```

The mandated form makes a class's dependencies readable as one list in its signature, which is
the property the hand-written DI container relies on when you are checking the wiring.

> [!IMPORTANT]
> Parameter properties emit runtime code, so Node's native type stripping (`node file.ts`)
> **cannot** run this codebase. That is why `apps/worker` uses `tsx`, which transpiles rather
> than strips. Revisiting means setting `erasableSyntaxOnly: true` and rewriting every
> constructor.

### `prefer-readonly`

A private field never reassigned after construction should say so — which makes the genuinely
mutable fields visible by contrast.

### The three `"off"` entries

`no-explicit-any`, `no-unused-vars`, `consistent-type-imports`. Biome owns all three
(`noExplicitAny`, its recommended unused-variable rule, and `useImportType`). Leaving them on
would double-report every violation.

---

## Block 3 — the OOP shape rules

```js
const OOP_PACKAGES = [
  "packages/{core,permissions,contracts,application,db,infrastructure,auth,composition,api-client,asset,content}/src/**/*.ts",
];
```

**That glob is the only place the React/non-React split is written down.** `query`, `ui`,
`feature`, and `apps/*` are excluded — React components and hooks are functions by contract
with the framework, and these selectors would reject every correct file in them.

Four `no-restricted-syntax` selectors, covering the three ways a function escapes a module
plus static mutable state:

```ts
// ✗ wrong — behaviour floating free of the data it operates on
export function canReactivate(caps: CapabilitySet, taskId: string) { … }

// ✓ right — behaviour belongs to the thing that has the data
class CapabilitySet {
  public can(permission: PermissionKey, goalId?: string): boolean { … }
}
```

Free functions are how a codebase loses its shape, and the mechanism is always the same:
`canReactivate` lands in a utils file, someone copies it for a variant, and now there are two
answers to the same permission question with no signal they were meant to agree. A method on
`CapabilitySet` cannot be copied without copying the class.

The rule has teeth here specifically because the architecture's central claim is that
`CapabilitySet.can()` is *one* implementation shared by the oRPC handler, the React `<Can>`,
the route guard, and the worker.

### The static-mutable-state ban

```js
selector: "ClassBody > PropertyDefinition[static=true][readonly!=true]";
```

> [!WARNING]
> This catches a real production bug rather than a design smell. A `static cache = new Map()`
> on a repository looks correct locally, passes every test, and under concurrency serves user
> A's rows to user B. Where row visibility *is* the permission model, that is a cross-tenant
> leak, not a caching bug.

`static readonly` passes. The one gap: a `static readonly Map` — the binding is readonly, the
map is not.

### What deliberately does not trip these

| Pattern | Why it passes |
| --- | --- |
| Zod schemas | `static readonly` class members |
| Drizzle tables | a `pgTable` call expression, not an arrow function |
| Permission fragments | an object literal |
| Contract routers | an object literal, and oRPC's inference needs the literal shape |

Those are data shapes, not behaviour. The selectors target function declarations and arrow
functions precisely so declarative exports stay legal.

Biome's `noStaticOnlyClass` is `off` for the mirror-image reason: `Uuid`, `Identifiers`,
`ProcedurePermissions`, and `PermissionRegistry` are intentionally static-only namespacing
classes, each with a `private constructor()` marking it uninstantiable.

---

## Block 4 — bans needing type-import nuance

Two packages need bans that Biome cannot express. Both are here for the same reason.

### `packages/feature` — the `api-client` and router bans

```js
files: ["packages/feature/src/**/*.{ts,tsx}"],
rules: {
  "no-restricted-imports": "off",
  "@typescript-eslint/no-restricted-imports": ["error", { paths: [
    { name: "@loadbearing/api-client", allowTypeImports: true, message: "…" },
    { name: "@tanstack/react-router",  allowTypeImports: true, message: "…" },
  ]}],
}
```

> [!IMPORTANT]
> **Biome's `noRestrictedImports` flags `import type` exactly like a value import** and has no
> exemption — verified against 2.5.7. `SignInForm` needs
> `import type { AuthClient } from "@loadbearing/api-client"`, a type-only import that emits
> nothing and creates no runtime dependency, so a Biome-side ban would error on correct code.
>
> The core ESLint rule has the same limitation, which is why it is switched `"off"` — leaving
> both on means the core one still fires and the exemption never takes effect.

The bans themselves are load-bearing. The first stops `await client.task.list()` appearing
inside a component under deadline pressure — it works perfectly and becomes a read no mutation
will ever refresh. The second is what lets a Tauri webview mount `feature` under an entirely
different routing shell.

### `packages/content` — the `PermissionKey` ban

`content` legitimately imports `ModuleKey` from `@loadbearing/permissions` and must never
import `PermissionKey` or `PermissionRegistry`. That is a **named-export** ban, and Biome's
rule bans whole modules only.

Nav items carry `module: "rbac"`, never `permission: "rbac.role.read"`. If `permission` were a
content field, a CMS edit would be a privilege escalation.

**The pattern across both:** Biome handles bans that are "this whole module, no exceptions";
ESLint handles the ones needing named-export or type-import nuance.

---

## The `lazy()` ban — `packages/feature` and `apps/web`

```js
files: ["packages/feature/src/**/*.{ts,tsx}", "apps/web/src/**/*.{ts,tsx}"],
rules: { "no-restricted-syntax": ["error",
  { selector: "ImportDeclaration[source.value='react'] > ImportSpecifier[imported.name='lazy']" },
  { selector: "CallExpression[callee.type='Identifier'][callee.name='lazy']" },
  { selector: "MemberExpression[object.name='React'][property.name='lazy']" },
]}
```

Rule 9 of [visibility](../../../../docs/opinions/visibility.md): **never lazy-load by
permission.** The bundle is not a secret, so a `lazy()` keyed on a permission hides nothing. It
only adds a network waterfall to the one path the user is allowed to take. No type can hold the
rule, which is why it is a lint.

Three selectors, because there are three ways to spell it. The import catches `lazy as load`.
The call catches a `lazy` from anywhere else. The member expression catches `React.lazy`.

**The ban costs nothing.** Route splitting belongs to the router. TanStack's
`lazyRouteComponent` and `createLazyFileRoute` have different names and pass. Neither tree
held a `lazy()` when the ban landed.

> [!NOTE]
> Neither glob sits inside `OOP_PACKAGES`, and that matters. Flat config replaces a rule's
> options rather than merging them. If the two blocks overlapped, whichever came later would
> silently drop the other's selectors.

---

## See also

- [Overview](../index.md) — the two-tool split, dependency layout, and bin resolution
- [Build order · 05](../../../../docs/setup/05-lint-and-format.md) — the `biome.json` half
