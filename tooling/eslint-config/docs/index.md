---
title: "@loadbearing/eslint-config"
description: One flat config holding the rules Biome cannot express — the AST-shape assertions that are the architecture, plus the typed rules that need a whole TypeScript program.
---

# `@loadbearing/eslint-config`

Biome does the formatting and the bulk of the linting. This package exists for what Biome
cannot express. It is one config with `files`-scoped blocks — not three presets a package
picks from.

| | |
| --- | --- |
| **Package** | `@loadbearing/eslint-config` (private, never published) |
| **Entrypoint** | `./src/index.js` via `main`, typed by `./src/types/index.d.ts` |
| **Consumed by** | the workspace root only |
| **Build step** | none — plain ESM, loaded directly |

```
tooling/eslint-config/
├── package.json
├── docs/
└── src/
    ├── index.js            ← one config, four blocks
    └── types/
        └── index.d.ts      ← hand-written; no build to emit it
```

---

## The division of labour

Two linters is a cost, so it is worth being precise about what each one buys.

| Concern | Owner | Why |
| --- | --- | --- |
| Formatting, import organisation | **Biome** | one binary, ~10× faster, no plugin |
| Most lint rules | **Biome** | runs on save and in the pre-commit hook |
| Whole-module import bans | **Biome** | `noRestrictedImports` with exact paths |
| Parameter properties **required** | **ESLint** | Biome's rule bans them — the opposite direction |
| No exported free functions / no static mutable state | **ESLint** | AST-shape selectors; Biome has no equivalent |
| Typed rules (`no-floating-promises`) | **ESLint** | needs a whole TypeScript program |
| Bans needing named-export or type-import nuance | **ESLint** | Biome cannot exempt either |

> [!IMPORTANT]
> **Whenever a rule exists in both tools, Biome owns it.** Three rules are explicitly `"off"`
> here for that reason — `no-explicit-any`, `no-unused-vars`, `consistent-type-imports`. Two
> linters reporting the same violation produces duplicate editor diagnostics and teaches
> people to ignore both.

The fast tool runs on every save and every commit; this one runs on pre-push and in CI. That
split is why the pre-commit hook stays under a second, and a hook that runs is worth more
than a thorough hook that gets disabled.

---

## How it is consumed

**`eslint.config.js`** at the workspace root — the only consumer:

```js
export { default } from "@loadbearing/eslint-config";
```

```json
"devDependencies": { "@loadbearing/eslint-config": "workspace:*" }
```

**No package has a lint config, and no package has a lint script.** Both linters take the
whole repo in one invocation from the root, keyed on file globs. Fourteen fewer config files,
and no package can quietly opt itself out of a rule that exists to constrain it.

> [!NOTE]
> ESLint 9 resolves flat config from the **working directory**, not per file — a nearer config
> is ignored. In a per-package setup that is a footgun: a package missing its config silently
> inherits the root's weaker rule set with a green run. Here it is a non-issue, because there
> is exactly one config and everything runs from the root.

---

## Dependency layout

```json
{
  "dependencies": { "typescript-eslint": "catalog:" },
  "devDependencies": { "eslint": "catalog:" }
}
```

**Declare what you import.** `src/index.js` imports `typescript-eslint` at runtime, so it is a
real dependency. It does **not** import `eslint` — that is the host loading this config — so
`eslint` is a devDependency, present for the `Linter` type in `src/types/index.d.ts` and to
satisfy `typescript-eslint`'s peer deterministically.

> [!CAUTION]
> **This package does not supply the `eslint` binary to anyone.** pnpm links executables only
> from a package's _direct_ dependencies, and this package has no `bin` field — so depending
> on it never puts `eslint` in a consuming package's `node_modules/.bin`.
>
> What makes `eslint .` work is the **root** `eslint` devDependency: pnpm puts the
> workspace-root `.bin` on `PATH` for every script it runs. Do not remove it on the
> assumption this package covers it.

The catalog pins one version for the workspace, so the root and this package resolve to the
same physical copy in the store — declaring it twice costs no disk and cannot skew.

---

## `src/types/index.d.ts`

Hand-written, because there is no build step to emit one:

```ts
import type { Linter } from "eslint";

declare const config: Linter.Config[];

export default config;
```

Without it the root `eslint.config.js` reports
`TS7016: Could not find a declaration file for module '@loadbearing/eslint-config'`.

The file is itself in the `ignores` list — `**/*.d.ts` is not inside any package's tsconfig
`include`, so a type-aware rule would fail on it with a parsing error rather than a finding.

---

## See also

- [Rules](reference/rules.md) — every block in the config and why it is there
- [`@loadbearing/tsconfig`](../../tsconfig/docs/index.md) — `verbatimModuleSyntax` pairs with
  Biome's `useImportType` the way it used to pair with `consistent-type-imports`
- [Build order · 05 · Lint & Format](../../../docs/setup/05-lint-and-format.md) — the
  `biome.json` half, and the two failure modes verified against Biome 2.5.7
