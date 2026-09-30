---
title: base
description: Every compiler option in the shared base, grouped by what it does — and the five that carry real architectural weight.
---

# `base.json`

Never extended directly by a package. It holds every compiler decision so the three
[presets](presets.md) share one copy and adding a flag is a single edit.

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

Note what is **absent**, in two categories.

`module` and `moduleResolution` are the only things the three presets disagree about, so they live
there rather than here.

**And nothing relative lives here at all** — no `exclude`, no `files`, no `include`, no
`tsBuildInfoFile`. A relative path resolves against the file it was written in, so an `exclude` here
excludes `tooling/tsconfig/src/dist` in every consuming package rather than that package's own. Both
`incremental` and `exclude` were removed for exactly that reason, and `exclude` was the more
insidious of the two: it did not fail, it simply replaced TypeScript's built-in default with a
no-op. Verify with `tsc --showConfig` from inside any package.

---

## The five that do real work

### `verbatimModuleSyntax`

The most consequential flag in the file. It requires `import type` for type-only imports and
emits imports **exactly as written** — no elision, no inference.

That is what makes type-only imports an architectural tool rather than a hint:

```ts
// packages/ui/src/can/can.tsx
import type { CapabilitySet, PermissionKey } from "@loadbearing/permissions";
```

The emitted JavaScript contains no import at all, so `@loadbearing/ui` references the
permission vocabulary with **zero runtime dependency** on `@loadbearing/permissions`. The
instance arrives as a prop. The same mechanism lets `content` name `ImageKey` without
pulling `asset`'s binaries into the worker's bundle.

Paired with Biome's `useImportType`
([05](../../../../docs/setup/05-lint-and-format.md)), which makes writing the import the other
way an error.

### `noImplicitOverride`

Forces the `override` keyword on every method redefining a base method. This codebase is
built on abstract classes — `Clock`, `Result`, and every port in `application`:
`VectorStore`, `StorageGateway`, `CacheStore`, `QueuePublisher`, `SessionResolver`,
`UnitOfWork`, `DomainEventPublisher`, `ActivityLogger`, `EmbeddingProvider`.

Without this flag, renaming a base method leaves every subclass silently no longer
overriding anything — they just gain an unrelated method and the abstract one goes
unimplemented in a way that is easy to miss. With it, the rename produces a compile error in
each subclass, which is precisely the list of files you need to visit.

> [!NOTE]
> This protection only applies where an implementation `extends` its port. Adapters that
> `extends BaseRepository implements SomePort` — single inheritance forces the choice —
> forfeit it, because `implements` members are not overrides. Worth knowing when you write a
> Postgres adapter.

### `noUncheckedIndexedAccess`

Makes `record[key]` return `T | undefined`. Annoying for about a week, then permanently
useful: it is why `ProcedurePermissions.required(path)` has an honest
`PermissionKey | undefined` return type instead of lying about a lookup that can miss — and
that honest type is what makes the oRPC middleware's fail-closed check natural to write
rather than something you have to remember.

It also produces the `!` non-null assertions you will see in tight loops over
freshly-constructed arrays (`bytes[6]!` in `Uuid.v7()`), where the index is provably in
range. Those are the intended escape, used sparingly.

### `forceConsistentCasingInFileNames`

Matters more than usual here because every filename is kebab-case with a dot-suffix role.
Windows and macOS filesystems are case-insensitive; Linux CI is not. Without this flag,
`import "./TaskEntity.js"` for a file named `task.entity.ts` compiles on a developer machine
and fails in CI with an error that reads like a missing file.

### `isolatedModules`

Matches how tsup and esbuild actually transpile — file by file, with no cross-file type
information. Turning it on means the compiler rejects the patterns a single-file transpiler
would silently mistranslate, so `tsc --noEmit` passing is real evidence that `tsup` will
produce correct output.

---

## `target: "ES2024"`

Chosen for the **runtime**, not for a browser support matrix. Node 24 ships V8 13.6, which
implements ES2024 in full — `Object.groupBy`, `Promise.withResolvers`,
`Array.prototype.toSorted`, the RegExp `v` flag. Downlevelling to ES2023 would make the
compiler emit helper code for features the runtime has natively.

For the browser side, Vite's own `build.target` governs what ships. This setting governs
what the compiler is allowed to assume exists.

> [!WARNING]
> Keep this aligned with the `target` in each package's `tsup.config.ts`. A tsup target of
> `es2023` against a compiler target of `ES2024` means the compiler permits syntax the
> bundler will downlevel, which is harmless but wasteful — and the mismatch is easy to
> introduce by copying a stale template.

`lib: ["ES2024"]` with **no DOM** is covered in the [overview](../index.md#the-one-decision-that-shapes-everything-else)
— it is the flag that makes browser globals a compile error outside React packages.

---

## The rest, briefly

| Option | Why |
| --- | --- |
| `strict` | the baseline everything else assumes |
| `noFallthroughCasesInSwitch` | discriminated-union switches are common in the error and status handling; an accidental fallthrough is silent |
| `useUnknownInCatchVariables` | a caught value is `unknown` until narrowed, which pairs with `DomainError` being matched on its `code` string rather than by `instanceof` |
| `esModuleInterop` | required for the handful of CJS-only transitive dependencies |
| `skipLibCheck` | skips type-checking `.d.ts` files in `node_modules`; a large build-time saving, and third-party type errors are not yours to fix |
| `resolveJsonModule` | lets a package import a JSON file directly |
| `moduleDetection: "force"` | every file is a module, so no file accidentally becomes a global script |
| `declaration` + `declarationMap` | `.d.ts` plus source maps for them, so *Go to Definition* across a package boundary lands in `src/` rather than in generated types |
| `sourceMap` | stack traces point at TypeScript |

---

## `exactOptionalPropertyTypes` is off, deliberately

It is the more correct setting — it distinguishes "property absent" from "property present
and `undefined`" — and it fights Zod's `.optional()` output shape hard enough to cost more
than it returns. Since every boundary in this codebase is a Zod schema, that fight would be
constant.

Revisit it if you ever find a bug it would have caught. Turning it on later is a mechanical
but wide change.

---

## See also

- [`presets`](presets.md) — what `library`, `node-esm`, and `react` add on top
- [Overview](../index.md) — how packages consume this and how it pairs with the linters
