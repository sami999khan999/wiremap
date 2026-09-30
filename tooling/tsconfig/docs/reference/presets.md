---
title: presets
description: The three thin presets — library, node-esm, react — what each changes and which packages pick it.
---

# Presets

Each extends [`base.json`](base.md) and changes only what genuinely differs: module
resolution, whether `tsc` emits, and whether the DOM exists.

---

## `library.json`

For all fourteen `packages/*`.

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

**`noEmit: true`** because tsup does the emitting. `tsc` runs in a package only as
`typecheck`, never as a build. That separation is what lets `pnpm typecheck` run across the
whole workspace without producing a single artefact.

**`moduleResolution: "Bundler"`** because every consumer of these packages is a bundler —
Vite for the web app, tsup for the package builds, tsx for the worker's dev loop. Bundler
resolution understands `exports` maps including the `development` condition, which is what
lets Vite resolve `@loadbearing/core` straight to `src/index.ts` in dev and hot-reload
package edits with no rebuild.

---

## `node-esm.json`

For `apps/worker`, and any script run directly by Node.

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

**`NodeNext` is Node's own ESM resolver**, which means relative imports need the `.js`
extension even though the file on disk is `.ts`:

```ts
import { Container } from "./container.js";
```

> [!IMPORTANT]
> Write the `.js` extension **everywhere**, including in `packages/*` where `Bundler`
> resolution does not require it. Consistency costs nothing and it means a file can move
> between a package and the worker without an edit. Every code sample in this repository
> follows that rule.

**`types: ["node"]`** brings in `@types/node`. Note the pairing constraint: `@types/node`
must track the same major as the runtime in `.nvmrc`. Types from a different major produce
APIs that typecheck and then throw.

**No `noEmit` here** — this is the one place `tsc` is the build. `apps/worker` has no bundler
at all; its `build` script is `tsc -p tsconfig.json` emitting plain ESM, and its own
`tsconfig.json` adds `outDir` and `rootDir`.

> [!NOTE]
> There is no `node-cjs.json`. Nothing in this stack is CommonJS — oRPC is ESM-only, TanStack
> Start is ESM, and every package sets `type: "module"`. That removes an entire class of
> dual-package-hazard problem.

### Why the worker uses `tsx` and not Node's native TypeScript support

Node 24 runs `.ts` files by **stripping** types, which erases syntax but rejects any
TypeScript construct that emits runtime code — enums, namespaces, decorators, and,
decisively, constructor parameter properties:

```ts
constructor(private readonly clock: Clock) {}
```

That form is not merely used here, it is *mandated* by the `parameter-properties` rule in
[eslint-config rules](../../../eslint-config/docs/reference/rules.md). Native stripping would reject the
first file it read. `tsx` transpiles rather than strips, so it handles all of it.

---

## `react.json`

For `apps/web`, `packages/ui`, `packages/feature`, and `packages/query`.

```json
{
  "extends": "./base.json",
  "compilerOptions": {
    "lib": ["ES2024", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "jsx": "react-jsx",
    "noEmit": true,
    "types": ["vite/client"]
  }
}
```

**`lib` adds DOM back.** This is the only preset that does, and it is the mechanism described
in the [overview](../index.md#the-one-decision-that-shapes-everything-else): browser globals are
a compile error everywhere else.

**`jsx: "react-jsx"`** is the automatic runtime — no `import React` at the top of every file.

**`types: ["vite/client"]`** provides `import.meta.env` and asset-import types.

> [!TIP]
> `packages/asset` needs its own `asset.d.ts` declaring `*.svg`, `*.webp`, and `*.png`
> modules, because it uses `library.json` rather than `react.json` — it is deliberately
> React-free so that `content` and `apps/worker` can import it.

---

## Picking a preset

| If the package… | Use | Because |
| --- | --- | --- |
| ships React components or hooks | `react` | needs DOM and JSX |
| is a `packages/*` library, no React | `library` | tsup emits, bundler resolves |
| is a Node process with no bundler | `node-esm` | `tsc` emits, Node resolves |

The one that catches people out: **`packages/query` uses `react`**, not `library`, because it
exports a provider component and hooks. `packages/api-client` sits right next to it and uses
`library`, because it is deliberately React-free — and for the same reason `api-client` is in
the OOP glob in the ESLint config while `query` is not.

---

## See also

- [`base`](base.md) — every option the presets inherit
- [Overview](../index.md) — how packages consume these and how they pair with the linters
