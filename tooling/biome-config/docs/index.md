---
title: "@loadbearing/biome-config"
description: The Biome configuration — formatting, import organisation, and the fast lint rules. One base file the root extends, replacing Prettier entirely.
---

# `@loadbearing/biome-config`

Biome is one Rust binary that formats, organises imports, and lints roughly ten times faster
than ESLint and Prettier together. It replaced Prettier completely and took over most of the
linting; [`@loadbearing/eslint-config`](../../eslint-config/docs/index.md) keeps only the rules
Biome cannot express.

| | |
| --- | --- |
| **Package** | `@loadbearing/biome-config` (private, never published) |
| **Holds** | `src/base.json` — the entire configuration |
| **Consumed by** | the root `biome.json`, via a relative `extends` |
| **Dependencies** | none — the `biome` binary is a root devDependency |
| **Build step** | none — JSON, read directly by the Biome CLI |

```
tooling/biome-config/
├── package.json
├── docs/
└── src/
    └── base.json       ← formatter, assist, linter, overrides
```

---

## How it is wired

The root `biome.json` is two lines:

```json
{
  "$schema": "https://biomejs.dev/schemas/2.5.7/schema.json",
  "extends": ["./tooling/biome-config/src/base.json"]
}
```

> [!IMPORTANT]
> **The link is a relative path, not a package specifier.** `extends: ["@loadbearing/biome-config/src/base.json"]` does **not** resolve — verified against 2.5.7, and it still fails with an `exports` map declaring the file. Biome's config resolver is not Node's.
>
> So this is a workspace member for organisational reasons — it holds the config and its docs
> alongside the other `tooling/*` packages — not because anything resolves it by name. It has
> no dependencies and nothing importable.

### Why this is unusual, and what it does not change

Unlike `tsconfig` and `eslint-config`, this package is **not** a resolution target:

| | `tsconfig` / `eslint-config` | `biome-config` |
| --- | --- | --- |
| How the root reaches it | module resolution (`extends`, `import`) | relative file path |
| Declared in root `devDependencies` | yes — required for the symlink | **no** — nothing to resolve |
| Provides the binary | no | no — `@biomejs/biome` at the root does |

`@biomejs/biome` ships only a `bin` — no `main`, no `exports`, and `require.resolve` on it
fails outright. There is nothing to import from Biome, which is why the tool itself needs no
config package and why this one carries no dependency on it.

> [!NOTE]
> Two path-resolution questions were verified before splitting the config out of the root, because both would have failed silently:
>
> - **`overrides.includes` globs resolve against the root config, not this file.** A glob like `packages/feature/**` still means what it says; it is not looked for under `tooling/biome-config/`.
> - **`vcs.useIgnoreFile` still finds the root `.gitignore`.**
>
> Confirm both again if you ever move this file.

---

## What `base.json` configures

### Formatter

```json
"formatter": {
  "enabled": true,
  "indentStyle": "space",
  "indentWidth": 2,
  "lineWidth": 100,
  "lineEnding": "lf"
},
"javascript": {
  "formatter": { "quoteStyle": "double", "semicolons": "always", "trailingCommas": "all" }
}
```

**`lineWidth: 100`, not 80.** Constructor parameter properties are the dominant shape in this
codebase, and the `parameter-properties` ESLint rule makes that form mandatory rather than
optional:

```ts
constructor(private readonly tasks: TaskRepository, private readonly clock: Clock) {}
```

Every non-trivial one wraps to five or six lines at 80 columns.

**`lineEnding: "lf"`** is the third leg of a three-part line-ending fix. All three are required;
any two leave a gap:

| Layer | Mechanism | Catches |
| --- | --- | --- |
| Git | `core.autocrlf input` + `.gitattributes` | what gets committed |
| Editor | `.editorconfig` | what gets typed, in editors without a Biome plugin |
| Biome | `lineEnding: "lf"` | what gets written on format |

> [!IMPORTANT]
> Drop any one and a single commit from a Windows machine shows every line of every file as
> modified. Code review stops working, and the fix afterwards is `git add --renormalize .`
> plus an explanation.

### Import organisation

```json
"assist": { "enabled": true, "actions": { "source": { "organizeImports": "on" } } }
```

An **assist action**, not a lint rule. It replaces `prettier-plugin-organize-imports` with no
plugin to install — one of the concrete things the Biome switch deleted.

### Files and VCS

```json
"vcs": { "enabled": true, "clientKind": "git", "useIgnoreFile": true },
"files": { "includes": ["**", "!**/dist", "!**/.output", "!**/migrations"] }
```

`useIgnoreFile` means `.gitignore` is honoured, which is why this repo has no `.prettierignore`
equivalent — that file was deleted with Prettier.

`migrations` is excluded because Drizzle generates that SQL and reformatting it produces a diff
on every `db:generate`.

---

## Lint rules

`"preset": "recommended"` plus five deliberate changes.

> [!NOTE]
> `"recommended": true` is deprecated as of Biome 2.5 — use `"preset": "recommended"`. If you
> inherit an older config, `biome migrate --write` converts it for you.

| Rule | Setting | Why |
| --- | --- | --- |
| `useConsistentMemberAccessibility` | `error`, `"explicit"` | every method reads `public` or `private`; in an OOP codebase the public surface of a class *is* its contract |
| `useImportType` | `error` | pairs with `verbatimModuleSyntax` so a type-only import emits nothing |
| `noProcessEnv` | `error` | config is read once per app, in `env.ts` |
| `noRestrictedImports` | `error` | the server-only boundary — see [boundary](reference/boundary.md) |
| `noExplicitAny` | `error` | promoted from a warning |
| `noStaticOnlyClass` | **`off`** | the intended pattern here, not a smell |

### `useImportType` is the load-bearing one

It pairs with `verbatimModuleSyntax` in
[`@loadbearing/tsconfig`](../../tsconfig/docs/reference/base.md). The compiler flag guarantees a
type-only import emits no runtime import; this rule guarantees the import is *written* as
type-only in the first place. Together they turn "`@loadbearing/ui` may reference
`PermissionKey` without depending on `permissions`" from a convention into something the build
enforces.

### `noStaticOnlyClass` is off on purpose

It would flag `Uuid`, `Identifiers`, `ProcedurePermissions`, `PermissionRegistry`,
`StorageKey`, `ApiKeyHasher`, and `QueueName` — every static-only namespacing class. Each has a
`private constructor()` marking it intentionally uninstantiable. Leaving the rule on would mean
a suppression comment on all of them, or converting them to the exported free functions the
ESLint OOP selectors exist to prevent.

### `noProcessEnv` needs a companion

```json
"noRestrictedImports": { "options": { "paths": {
  "node:process": "Config is read once in apps/*/src/env.ts and passed down."
} } }
```

The rule catches `process.env.FOO` but **not** `import { env } from "node:process"`. Both
entries are needed to close the door. The exemption for the two `env.ts` files is an override —
see [boundary](reference/boundary.md).

---

## What Biome deliberately does not own

Three things stay with ESLint, and the split is a division of labour rather than a compromise:

- **`parameter-properties`** — Biome's `noParameterProperties` *bans* the form; nothing requires it.
- **The typed promise rules** — Biome has `noFloatingPromises`/`noMisusedPromises`, but verified against 2.5.7 they miss **`abstract` class members** while catching concrete methods and interface members. Since every port here is an abstract class, that is the whole port surface. Both are `nursery` and stay off.
- **The OOP shape selectors** — AST assertions with no Biome equivalent.
- **Bans needing named-export or type-import nuance** — Biome's `noRestrictedImports` flags
  `import type` like a value import and cannot target named exports.

The rule of thumb: **Biome owns "this whole module, no exceptions"; ESLint owns anything
needing nuance.** See [eslint-config rules](../../eslint-config/docs/reference/rules.md).

---

## See also

- [The server-only boundary](reference/boundary.md) — every `overrides` block and the two failure modes
- [`@loadbearing/eslint-config`](../../eslint-config/docs/index.md) — the other half
- [Build order · 05 · Lint & Format](../../../docs/setup/05-lint-and-format.md)
