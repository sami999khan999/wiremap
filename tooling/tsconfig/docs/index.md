---
title: "@loadbearing/tsconfig"
description: One strict base and three presets, published as a workspace package so every tsconfig.json in the repository is four lines long.
---

# `@loadbearing/tsconfig`

Four JSON files. One strict base carrying every compiler decision, and three thin presets
that differ only in module resolution and DOM availability. Every `tsconfig.json` in the
repository is four lines, which means there is no place for a per-package compiler setting to
drift.

| | |
| --- | --- |
| **Package** | `@loadbearing/tsconfig` (private, never published) |
| **Files** | `src/base.json`, `src/library.json`, `src/node-esm.json`, `src/react.json` |
| **Build step** | none — JSON, read directly by `tsc` |
| **Dependencies** | none |

---

## The four files

```
tooling/tsconfig/
├── package.json     ← exports map; no `type`, no build
├── docs/
└── src/
    ├── base.json         ES2024, strict + five extra flags, no DOM
    ├── library.json      Bundler resolution, noEmit      → packages/*
    ├── node-esm.json     NodeNext resolution, node types → apps/worker
    └── react.json        Bundler resolution, DOM, jsx    → apps/web, ui, feature, query
```

The three presets each `"extends": "./base.json"` — an ordinary relative sibling inside
`src/`, which never goes through the exports map.

`base.json` is never extended directly by a package. It exists so the three presets share one
copy of every decision, and so that adding a flag is one edit rather than three.

| Preset | Module / resolution | `lib` | Emits | Used by |
| --- | --- | --- | --- | --- |
| [`library`](reference/presets.md#libraryjson) | `ESNext` / `Bundler` | ES2024 | no — tsup emits | all fourteen `packages/*` |
| [`node-esm`](reference/presets.md#node-esmjson) | `NodeNext` / `NodeNext` | ES2024 | yes — `tsc` is the build | `apps/worker` |
| [`react`](reference/presets.md#reactjson) | `ESNext` / `Bundler` | ES2024 + DOM | no — Vite emits | `apps/web`, `ui`, `feature`, `query` |

---

## How a package consumes it

```json
{
  "extends": "@loadbearing/tsconfig/library.json",
  "include": ["src/**/*.ts", "src/**/*.tsx"]
}
```

and declares the dependency:

```json
"devDependencies": { "@loadbearing/tsconfig": "workspace:*" }
```

That is the whole integration. `apps/web` adds two lines for its path alias and Vite client
types; `apps/worker` adds `outDir` and `rootDir` because it is the one place `tsc` actually
emits.

---

## Why this package has an `exports` map but no `type` and no build

```json
{
  "name": "@loadbearing/tsconfig",
  "version": "0.0.0",
  "private": true,
  "exports": {
    "./base.json": "./src/base.json",
    "./library.json": "./src/library.json",
    "./node-esm.json": "./src/node-esm.json",
    "./react.json": "./src/react.json"
  },
  "files": ["src"]
}
```

No `type` and no build, because this is JSON that no JavaScript ever imports — `tsc` reads it
directly.

**The `exports` map earns its place by keeping the consumer-facing specifier short.** The
presets live in `src/`, but every `tsconfig.json` in the repository still writes:

```json
{ "extends": "@loadbearing/tsconfig/library.json" }
```

TypeScript honours `exports` for `extends` resolution, so `src/` never leaks into the fifteen
files that consume this package. Without the map you would either write
`@loadbearing/tsconfig/src/library.json` everywhere or keep the JSON at the package root.

> [!IMPORTANT]
> An `exports` map is an **allowlist**. All four presets must be listed. Add a fifth and
> forget to register it and `extends` fails with `TS6053: File not found`, which reads like a
> missing file rather than a missing map entry.

`files: ["src"]` does not affect resolution — the package is private and consumed through a
workspace symlink, so every file is present regardless. It is there so the right things would
ship if that ever changed.

---

## The one decision that shapes everything else

**`base.json` sets `lib: ["ES2024"]` with no DOM, and only `react.json` adds it back.**

That is not an oversight or a size optimisation. It is what makes `document.querySelector`
inside `@loadbearing/application` a **compile error** rather than a runtime crash in the
worker. A package that has never heard of a browser cannot accidentally acquire a dependency
on one.

It is also why `ServerOnly.assert()` is written as:

```ts
if (typeof window !== "undefined") {
```

rather than referencing `window` directly — `window` is not a known identifier in a package
compiled against `library.json`, so the `typeof` guard is the only form that compiles there.

---

## Relationship to the other tooling

TypeScript, Biome, and ESLint each own one layer and they are wired to agree:

| Concern | Owner | Pairs with |
| --- | --- | --- |
| What compiles | this package | — |
| Type-only imports emit nothing | `verbatimModuleSyntax` here | Biome's `useImportType` |
| Imports sorted and pruned | — | Biome's `organizeImports` assist action |
| Type-aware lint rules | `projectService` discovers these files | [eslint-config rules](../../eslint-config/docs/reference/rules.md) |

The `verbatimModuleSyntax` / `useImportType` pairing is the one to internalise:
the compiler flag guarantees a type-only import emits no runtime import, and Biome's rule
guarantees the import is written as type-only in the first place. Together they turn
"`@loadbearing/ui` may reference `PermissionKey` without depending on `permissions`" from a
convention into something the build enforces.

> [!TIP]
> Set your editor to the workspace TypeScript version rather than its bundled copy — in
> VS Code, *TypeScript: Select TypeScript Version* → **Use Workspace Version**. Otherwise
> `verbatimModuleSyntax` and `noUncheckedIndexedAccess` behave differently in the editor than
> in `pnpm typecheck`, which is a genuinely confusing way to spend an afternoon.

---

## See also

- [`base`](reference/base.md) — every compiler option and why it is set
- [`presets`](reference/presets.md) — what each preset changes, and which one a package picks
- [Build order · 04 · TypeScript Configs](../../../docs/setup/04-typescript-configs.md) — original rationale
