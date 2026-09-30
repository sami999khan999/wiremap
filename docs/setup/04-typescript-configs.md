# 04 · TypeScript Configs

> One base and three variants, published as a workspace package so every `tsconfig.json` in the repo is four lines long.

**Delivers:** `@loadbearing/tsconfig` with `base`, `library`, `node-esm`, and `react`.

**Prerequisite:** [03 · Workspace & Catalogs](03-workspace-and-catalogs.md)

---

## Step 4.1 — The package

```bash
node -e "require('fs').mkdirSync('tooling/tsconfig/src', { recursive: true })"
```

**`tooling/tsconfig/package.json`**

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
> No `type` and no build — this is JSON that no JavaScript ever imports.

**The `exports` map is what keeps the consumer-facing specifier short.** The four presets live in `src/`, but every `tsconfig.json` in the repository still writes `"extends": "@loadbearing/tsconfig/react.json"` rather than leaking `src/` into fifteen files. TypeScript honours `exports` for `extends` resolution, so the mapping is invisible to consumers.

> [!IMPORTANT]
> An `exports` map is an **allowlist**. All four presets must be listed — add a fifth file and forget to register it, and `extends` fails with `TS6053: File not found`, which reads like a missing file rather than a missing map entry.

Inside `src/`, the three presets extend the base by relative path (`"extends": "./base.json"`), so they resolve as ordinary siblings and never go through the map.

---

## Step 4.2 — `base.json`

**`tooling/tsconfig/src/base.json`**

```json
{
  "compilerOptions": {
    "target": "ES2024",
    "lib": ["ES2024"],

    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "useUnknownInCatchVariables": true,
    "exactOptionalPropertyTypes": false,

    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true,
    "moduleDetection": "force",

    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  }
}
```

> [!IMPORTANT]
> **No `exclude`, and no other relative path, ever belongs in a shared base.** A relative path is resolved against *the file it was written in*, so `"exclude": ["node_modules", "dist"]` here does not exclude a consuming package's `dist/` — it excludes `tooling/tsconfig/src/dist`, which does not exist. `tsc --showConfig` inside any package shows the damage plainly:
>
> ```json
> "exclude": ["../../tooling/tsconfig/src/node_modules", "../../tooling/tsconfig/src/dist"]
> ```
>
> That is worse than writing nothing, because declaring `exclude` at all **replaces** TypeScript's built-in default (`node_modules`, `bower_components`, `jspm_packages`, and `outDir`). The repo traded a working default for a no-op, and nothing failed — `include` is per-package and already scopes the program to `src/` and `tests/`, so the mistake stayed invisible.
>
> It is the same rule that removed `incremental`: `tsBuildInfoFile` in a shared base resolves against `tooling/tsconfig/src/` too, and all sixteen packages would collide on one file. **`files`, `include`, and `exclude` are per-package. Compiler options are shared. Nothing relative crosses that line.**

### The five that do real work

**`noImplicitOverride`** forces the `override` keyword on every method that redefines a base method. In a codebase built on abstract classes — `Clock`, `Result`, `VectorStore`, `StorageGateway`, `AuthStrategy`, every port in `application` — renaming a base method otherwise leaves subclasses silently no longer overriding anything. This flag turns that into a compile error in every subclass, which is exactly the list you need.

**`forceConsistentCasingInFileNames`** matters more than usual with kebab-case files. Windows filesystems are case-insensitive, Linux CI is not. Without it, `import './TaskEntity.js'` for a file named `task.entity.ts` compiles on a developer's machine and fails in CI with an error that reads like a missing file.

**`verbatimModuleSyntax`** requires `import type` for type-only imports and emits imports exactly as written. This is what makes the "type-only import" exemptions in the architecture real: `@loadbearing/ui` may import `PermissionKey` as a type from `@loadbearing/permissions` without creating a runtime dependency, and the compiler enforces that the emitted JS contains no import at all.

**`noUncheckedIndexedAccess`** makes `record[key]` return `T | undefined`. It is annoying for about a week and then it is the reason `ProcedurePermissions.required(path)` has an honest `PermissionKey | undefined` return type instead of lying about a lookup that can miss.

**`isolatedModules`** matches how tsup/esbuild actually transpile — file by file, no cross-file type information. Turning it on means the compiler rejects patterns esbuild would silently mistranslate.

**`target: "ES2024"`** is chosen for the runtime, not for a browser support matrix. Node 24 ships V8 13.6, which implements ES2024 in full — `Object.groupBy`, `Promise.withResolvers`, `Array.prototype.toSorted`, the RegExp `v` flag. Downlevelling to ES2023 would make the compiler emit helper code for features the runtime has natively. For the browser side, Vite's own `build.target` governs what ships; this setting governs what the compiler is allowed to assume exists.

`exactOptionalPropertyTypes` is off deliberately. It is correct but it fights Zod's `.optional()` output shape hard enough to cost more than it returns. Revisit it if you ever find a bug it would have caught.

---

## Step 4.3 — `library.json`

For all fifteen `packages/*`.

**`tooling/tsconfig/src/library.json`**

```json
{
  "extends": "./base.json",
  "compilerOptions": {
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "noEmit": true
  }
}
```
> `noEmit: true` because tsup does the emitting. `tsc` in a package runs only as `typecheck`. `moduleResolution: "Bundler"` because every consumer of these packages — Vite, tsup, tsx — is a bundler.

---

## Step 4.4 — `node-esm.json`

For `apps/worker`, and for any script run directly by Node.

**`tooling/tsconfig/src/node-esm.json`**

```json
{
  "extends": "./base.json",
  "compilerOptions": {
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "types": ["node"]
  }
}
```
> `NodeNext` is Node's own ESM resolver, which means **relative imports need the `.js` extension** — `import { Container } from "./container.js"` even though the file is `container.ts`. Do this consistently in `packages/*` too, even though `Bundler` resolution doesn't require it. Consistency costs nothing and it means a file can move between a package and the worker without an edit.

There is no `node-cjs.json`. Nothing in this stack is CommonJS.

---

## Step 4.5 — `react.json`

For `apps/web`, `packages/ui`, `packages/feature`, and `packages/query`.

**`tooling/tsconfig/src/react.json`**

```json
{
  "extends": "./base.json",
  "compilerOptions": {
    "lib": ["ES2024", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "jsx": "react-jsx",
    "noEmit": true
  }
}
```
> `jsx: "react-jsx"` is the automatic runtime — no `import React` at the top of every file.

> [!CAUTION]
> **Do not put `types: ["vite/client"]` here.** It looks right — it provides `import.meta.env` and asset-import types — but `packages/{ui,feature,query}` extend this preset and do **not** depend on Vite, so `tsc` fails them with `TS2688: Cannot find type definition file for 'vite/client'`. Vite only arrives with `apps/web` at [24](24-web-app.md), whose own `tsconfig.json` declares that `types` array itself. Only the app needs it.

> [!CAUTION]
> **`incremental` is deliberately absent from `base.json`.** With it, tsup's declaration build fails on every package with `TS5074: Option '--incremental' can only be specified using tsconfig, emitting to single file or when option '--tsBuildInfoFile' is specified.`
>
> Adding `tsBuildInfoFile` to `base.json` does not fix it: a relative path there resolves against `tooling/tsconfig/src/`, so all fifteen packages would collide on one build-info file. Since `tsc` here only ever runs as `--noEmit` typecheck, the caching was worth little; dropping the flag is the cheaper trade.

**Note the `lib` split.** `base.json` sets `lib: ["ES2024"]` with no DOM. That is not an oversight: it is what makes a `document.querySelector` inside `@loadbearing/application` a compile error rather than a runtime crash in the worker. Only the React variant adds DOM.

This is also why `ServerOnly.assert()` in [07](07-core-package.md) checks `typeof window !== "undefined"` rather than referencing `window` directly — `window` is not a known identifier in a `library.json` package.

---

## Step 4.6 — Consuming it

Every package's `tsconfig.json` is then four lines. This is the shape [06](06-package-anatomy.md) scaffolds:

```json
{
  "extends": "@loadbearing/tsconfig/library.json",
  "include": ["src/**/*.ts", "src/**/*.tsx"]
}
```

And every consumer declares the dependency:

```json
"devDependencies": { "@loadbearing/tsconfig": "workspace:*" }
```

---

## ✅ Gate

`tooling/tsconfig/` contains `package.json` plus `src/` with the four presets. Nothing to run yet — the first real check is in [07](07-core-package.md) when `packages/core` extends `library.json` and `tsc --noEmit` succeeds.

If you want to verify the `exports` mapping now rather than at step 07, `tsc --showConfig` in any package that extends it prints the fully resolved options; seeing `noUncheckedIndexedAccess` and `verbatimModuleSyntax` in the output proves the map and the relative `./base.json` chain both resolved.

---

[← Workspace & Catalogs](03-workspace-and-catalogs.md) · [Lint & Format →](05-lint-and-format.md)
