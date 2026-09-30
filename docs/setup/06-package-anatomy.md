# 06 · Package Anatomy

> The three config files every package has, its `src/` and `docs/`, why the `development` export condition exists, and a one-shot script that creates all sixteen.

**Delivers:** Sixteen structurally identical packages with placeholder classes, wired into a real dependency graph and building in topological order.

**Prerequisite:** [05 · Lint & Format](05-lint-and-format.md)

---

## The anatomy

Every package in `packages/` has exactly these three config files at its root, plus `src/` and
`docs/`:

```
packages/<name>/
├── package.json
├── tsconfig.json
├── tsup.config.ts
├── src/
│   ├── index.ts        ← the only public entrypoint
│   ├── import.ts       ← the only place the package reaches outside itself
│   └── <role>/         ← everything else; index.ts + the files of that kind
│       └── index.ts
└── docs/
    ├── meta.json       ← title, description, page order
    ├── index.md        ← what this package is for
    └── reference/      ← every page beyond the overview
        └── meta.json   ← group label and page order
```

**`docs/` is reference material, not build order.** Plain Markdown with YAML frontmatter —
never MDX — so it renders on GitHub today and can be picked up by a documentation site later
without touching the content.

**Only `index.md` and `meta.json` sit at the `docs/` root; everything else goes in
`reference/`.** `index.md` is the page a reader lands on — what the package is for, how it is
consumed, the decisions that shaped it. `reference/` holds the pages they consult afterwards,
with its own `meta.json` giving the group a sidebar label and ordering its pages. A small
package is one `index.md` and an empty `reference/`.

Callouts use GitHub alert syntax (`> [!NOTE]`, `> [!WARNING]`, `> [!CAUTION]`), which renders
natively on GitHub and maps cleanly onto a callout component later.

See `tooling/tsconfig/docs/` and `tooling/eslint-config/docs/` for worked examples of the
convention.

> [!NOTE]
> `docs/` is not in the `files` array and never ships — the published surface is `dist` only.
> It is also currently excluded from `pnpm format`, because `.prettierignore` contains a bare
> `docs/`, which matches at any depth. Narrow that to `/docs/` if you want package docs
> format-managed.

### `package.json` — the shape

```json
{
  "name": "@loadbearing/core",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "development": "./src/index.ts",
      "types": "./dist/index.d.ts",
      "default": "./dist/index.js"
    }
  },
  "files": ["dist"],
  "sideEffects": false,
  "scripts": {
    "build": "tsup",
    "dev": "tsup --watch",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "clean": "rimraf dist"
  },
  "devDependencies": {
    "@loadbearing/tsconfig": "workspace:*",
    "rimraf": "catalog:",
    "tsup": "catalog:",
    "typescript": "catalog:",
    "vitest": "catalog:"
  }
}
```

**The `development` export condition is the one non-obvious line.** With it, and with `resolve.conditions: ["development"]` in `apps/web/vite.config.ts` ([24](24-web-app.md)), Vite resolves `@loadbearing/core` straight to `src/index.ts`. Editing a package hot-reloads the browser with no rebuild step. Without it you consume `dist/` and every package edit needs `pnpm build:packages` before the change appears.

The condition order matters: `development` first, then `types`, then `default`. Node and tsup ignore `development` entirely and fall through to `default`, so production builds are unaffected.

**`type: "module"` everywhere.** ESM only. oRPC is ESM-only, TanStack Start is ESM, Node 24 is fine with it. There is no CJS build target anywhere in this repo, which removes an entire class of dual-package-hazard problems.

**`private: true` everywhere.** Nothing here is published. `files: ["dist"]` is belt-and-braces in case that ever changes.

### `tsup.config.ts` — identical in every package

```ts
import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: true,
  sourcemap: true,
  clean: true,
  target: "es2024",
});
```

> [!NOTE]
> **`clean` is `rimraf dist` and nothing else.** Two reasons it carries no `*.tsbuildinfo` glob:
>
> - Nothing produces one. `incremental` is deliberately absent from the shared tsconfig base ([04](04-typescript-configs.md)) because it breaks tsup's declaration build, so `tsc --noEmit` writes no build info.
> - **rimraf 6 does not expand globs unless you pass `--glob`.** Handed a literal `*.tsbuildinfo`, it fails on Windows with `Error: Illegal characters in path` (`EINVAL`), because `*` is not a legal filename character there. On Linux the same command silently succeeds while deleting nothing — so the bug is cross-platform and only *visible* on Windows.
>
> If you ever do need a glob in a `clean` script, write `rimraf --glob "dist" "*.tsbuildinfo"`.

One entry point per package. A package with multiple entrypoints is a package that wants splitting — the two exceptions (`@loadbearing/asset`'s CSS and SVG side-effect exports) are handled in [19](19-asset-package.md) and are not JavaScript.

### `tsconfig.json`

```json
{
  "extends": "@loadbearing/tsconfig/library.json",
  "include": ["src/**/*.ts", "src/**/*.tsx"]
}
```

> [!NOTE]
> **No lint script and no lint config.** Biome and ESLint each run once over the whole repo from the root ([05](05-lint-and-format.md)), keyed on file globs rather than per-package files. Fifteen fewer config files, and no package can quietly opt itself out of a rule.

**`"sideEffects": false` is a claim, and it is true of every package here.** None of them
import a CSS file or a polyfill for its side effect; `asset`'s stylesheet is a separate
`exports` entry that the app imports by path, not a bare import inside a module. The flag is
what lets a bundler drop an unused export *and everything it pulled in* rather than keeping the
module alive on the chance that importing it did something.

It is load-bearing in exactly one place today. `@loadbearing/content` exports both a
split-by-namespace source and a `BundledContentSource` that statically imports every locale
([20](20-content-package.md)); `packages/feature` imports `Translator` from that same barrel.
Without the flag, no bundler can prove the unused class is droppable, and every locale rides
into the client chunk through a barrel that never asked for it. **Get it wrong and nothing
fails — the bundle just quietly doubles**, which is why [26](26-hygiene-and-ci.md) greps for a
locale string in the entry chunk rather than trusting the flag.

### `src/index.ts` — the barrel

Every package has exactly one public entrypoint. Consumers write `import { Clock } from "@loadbearing/core"` and never `from "@loadbearing/core/dist/primitive/clock.js"`. The barrel is what makes internal reorganisation free: moving `clock.ts` from `primitive/` into `time/` is a one-line edit in `index.ts` and nobody downstream notices.

**Every folder gets its own `index.ts`, and the root barrel re-exports those** — **naming every symbol, never `export *`** ([Opinions · Imports](../opinions/imports.md)):

```ts
// packages/errors/src/index.ts
export { ERROR_CATALOG, type ErrorCode, type ErrorMeta, type ErrorSeverity } from "./catalog/index.js";
export {
  AppError,
  ConflictError,
  // …
  ValidationError,
} from "./error/index.js";
export { ErrorNormalizer } from "./normalizer/index.js";
export { HTTP_STATUS } from "./transport/index.js";
```

The root barrel names only folder barrels, because `src/` holds nothing else — see
[Opinions · Folders](../opinions/folders.md).

The named list is what makes the public surface a decision rather than a side effect: `export *` republishes anything a file exports, so widening the API becomes invisible in review. Biome's `noReExportAll` ([05](05-lint-and-format.md)) fails the build on a star, and `biome check --write` sorts the statements and the specifiers for you.

Note the `.js` extensions on relative imports throughout. `moduleResolution: "Bundler"` doesn't require them, but `NodeNext` in `apps/worker` does, and writing them everywhere means code moves between the two without an edit.

### `"use client"` — the boundary that makes Next work

The kit targets React, Next.js, and TanStack Start. Two of those need nothing extra. **Next's App
Router does**, because every module is a Server Component until something says otherwise, and a page
importing `<Can>` or `useSession` from a package that never declares a boundary fails the build with
*"You're importing a component that needs `useState`."*

So three packages carry the directive on the first line of their barrel:

```ts
// packages/ui/src/index.ts
"use client";

export { Icon } from "./icon/index.js";
```

`ui`, `query`, and `feature` — and **only** those three. All three are React components and hooks
end to end, so a barrel-level directive is accurate rather than a blunt instrument.

**What must never carry it**: `content`, `contracts`, `permissions`, `errors`, `core`,
`observability`. Those run on both sides. Marking `content` client-only breaks server-side rendering
of translated copy; marking `permissions` breaks the authorization check in a Server Component. This
is the half of the rule that gets fixed wrong under deadline, when someone adds the directive to make
one import stop complaining.

> [!NOTE]
> **The directive survives the build**, verified against this repo's `tsup` and esbuild 0.25 —
> a single entry point emits it at the top of `dist/index.js`. That is not something to assume:
> esbuild has historically dropped top-level directives, and a bundler upgrade that reintroduces
> the behaviour breaks Next silently, at the consumer, with an error naming their file.

Nothing about this affects a Vite SPA or TanStack Start, which treat the directive as a no-op.

The dangerous direction is not the missing directive — that fails loudly at the consumer's build.
It is one added to an isomorphic package to make a single import stop complaining, which fails
silently and in production. `check-architecture.mjs` §7 asserts the negative
([26](26-hygiene-and-ci.md)).

### `src/import.ts` — the outside surface

`index.ts` is what a package gives. `import.ts` is what it takes. **Every import from another
workspace package or an npm dependency is written once here and re-exported; the rest of `src/`
imports it from `./import.js`.** Reading one short file tells you everything the package depends
on — no `grep` across twenty modules, no drift between `package.json` and what the code actually
uses.

```ts
// packages/core/src/import.ts
// Everything this package takes from outside itself, in one place. No relative
// re-exports live here — that is what keeps it cycle-free.

// ── @loadbearing/errors ──────────────────────────────────────────────────────
export { ServerOnlyError } from "@loadbearing/errors";
```

**One separator comment per source**, workspace packages before npm ones. The point of the file is
that it is skimmable; a flat alphabetised list of thirty specifiers is not. Comments are `//`
throughout this repository — [Opinions · Comments](../opinions/comments.md).

Three rules keep it from becoming the hub that this pattern is usually warned about
([Opinions · Imports](../opinions/imports.md)):

1. **External only.** Never re-export a relative module from `import.ts`. That is the single
   constraint that makes a cycle impossible — `import.ts` has no edge back into the package.
2. **Named, never starred.** Same reason as the barrel, and `verbatimModuleSyntax` needs the
   inline `type` modifier: `export type { ErrorCode } from "@loadbearing/errors"` stays erased.
3. **No file, no dependencies.** `@loadbearing/errors` and `@loadbearing/permissions` have no
   `import.ts`, and that is the statement — they import nothing from outside themselves. Never
   commit an empty one.

> [!NOTE]
> The `no-restricted-imports` blocks in `tooling/eslint-config` match on the *specifier*, so they
> now fire on `import.ts` and nowhere else. That is where the rule belongs — the ban on
> `application` importing `HTTP_STATUS` is checked at the one line that could introduce it.

---

## Step 6.1 — The scaffold script

Sixteen structurally identical packages. Scripting it avoids sixteen chances to make a typo.

Create **`scaffold.mjs`** at the repo root:

```js
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// name → [entry extension, extra devDependencies]
const PACKAGES = {
  core: ["ts", {}],
  errors: ["ts", {}],
  observability: ["ts", {}],
  permissions: ["ts", {}],
  contracts: ["ts", {}],
  application: ["ts", {}],
  infrastructure: [
    "ts",
    { "drizzle-kit": "catalog:", tsx: "catalog:", "@types/pg": "catalog:", "@types/node": "catalog:" },
  ],
  auth: ["ts", { "@types/node": "catalog:" }],
  composition: ["ts", {}],
  asset: ["ts", {}],
  content: ["ts", {}],
  "api-client": ["ts", {}],
  query: ["tsx", { react: "catalog:react", "@types/react": "catalog:react" }],
  ui: ["tsx", { react: "catalog:react", "@types/react": "catalog:react" }],
  feature: ["tsx", { react: "catalog:react", "@types/react": "catalog:react" }],
};

for (const [name, [ext, extraDev]] of Object.entries(PACKAGES)) {
  const dir = join("packages", name);
  mkdirSync(join(dir, "src"), { recursive: true });
  mkdirSync(join(dir, "docs"), { recursive: true });

  const pkg = {
    name: `@loadbearing/${name}`,
    version: "0.0.0",
    private: true,
    type: "module",
    main: "./dist/index.js",
    types: "./dist/index.d.ts",
    exports: {
      ".": {
        development: `./src/index.${ext}`,
        types: "./dist/index.d.ts",
        default: "./dist/index.js",
      },
    },
    files: ["dist"],
    scripts: {
      build: "tsup",
      dev: "tsup --watch",
      typecheck: "tsc --noEmit",
      test: "vitest run --passWithNoTests",
      clean: "rimraf dist",
    },
    devDependencies: {
      "@loadbearing/tsconfig": "workspace:*",
      rimraf: "catalog:",
      tsup: "catalog:",
      typescript: "catalog:",
      vitest: "catalog:",
      ...extraDev,
    },
    ...(ext === "tsx"
      ? { peerDependencies: { react: "catalog:react", "react-dom": "catalog:react" } }
      : {}),
  };

  writeFileSync(join(dir, "package.json"), JSON.stringify(pkg, null, 2) + "\n");

  writeFileSync(
    join(dir, "tsconfig.json"),
    JSON.stringify(
      {
        extends: ext === "tsx" ? "@loadbearing/tsconfig/react.json" : "@loadbearing/tsconfig/library.json",
        include: ["src/**/*.ts", "src/**/*.tsx"],
      },
      null,
      2,
    ) + "\n",
  );

  writeFileSync(
    join(dir, "tsup.config.ts"),
    `import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.${ext}"],
  format: ["esm"],
  dts: true,
  sourcemap: true,
  clean: true,
  target: "es2024",
});
`,
  );

  // An empty barrel, not a placeholder class. `export {}` makes the file a module
  // rather than a script; tsup emits a 13-byte d.ts and nothing pretends to exist.
  writeFileSync(join(dir, `src/index.${ext}`), `export {};\n`);

  mkdirSync(join(dir, "docs/reference"), { recursive: true });

  writeFileSync(
    join(dir, "docs/meta.json"),
    JSON.stringify({ title: name, description: "", pages: ["index", "reference"] }, null, 2) +
      "\n",
  );

  writeFileSync(
    join(dir, "docs/reference/meta.json"),
    JSON.stringify({ title: "Reference", description: "", pages: [] }, null, 2) + "\n",
  );

  writeFileSync(
    join(dir, "docs/index.md"),
    `---
title: "@loadbearing/${name}"
description: TODO — one sentence on what this package is for.
---

# \`@loadbearing/${name}\`

> TODO — written when the package gets its first real file.

| | |
| --- | --- |
| **Package** | \`@loadbearing/${name}\` (private, never published) |
| **Entrypoint** | \`src/index.${ext}\` |
| **Depends on** | — |
| **Used by** | — |
`,
  );

  console.log(`scaffolded packages/${name}`);
}
```

```bash
node scaffold.mjs
```

```bash
node -e "require('fs').unlinkSync('scaffold.mjs')"
```
> Delete it. It is a one-shot, and leaving it invites someone to re-run it over real code.

**On React as a peer:** `query`, `ui`, and `feature` get React as a **peerDependency plus a devDependency**, never a plain dependency. Two copies of React in one tree produces "invalid hook call" errors that look like a bug in your components and take a day to trace.

**The peer ranges are `catalog:react`, not `^19`.** pnpm accepts the catalog protocol in `peerDependencies`, and using it means React's version lives in exactly one place — which is the whole point of the catalog, and also what stops two copies appearing. A literal `^19` here is flagged by `syncpack` as drift from the catalog.

---

## Step 6.2 — Wire the dependency graph

**One command per package, in this order.** `infrastructure` depends on `application`, so `application` must be declared first for the graph to resolve cleanly on the first pass.

### `@loadbearing/errors`
No runtime dependencies. It is the root of the graph and depends on nothing at all, because a failure has to be constructible and readable in the use-case that throws it, the transport that maps it, the component that renders it, and the worker that logs it. Any dependency would exclude one of those. See [09](09-errors-package.md).

### `@loadbearing/core`
```bash
pnpm add --filter @loadbearing/core @loadbearing/errors@workspace:*
```
> **One dependency, and it is the only one this package will ever have.** `ServerOnly.assert` throws, and nothing in this repository throws a bare `Error` ([09](09-errors-package.md) Step 9.3). Since `errors` is itself a leaf, `core` keeps the property that actually matters — it loads in a browser, a Node worker, a Tauri webview, or a bare test file.
>
> **`errors` is declared before `core` here on purpose.** The build order is the graph, not the doc numbers, and `pnpm build:packages` will show `errors` completing first.

### `@loadbearing/observability`
```bash
pnpm add --filter @loadbearing/observability @loadbearing/core@workspace:* @loadbearing/errors@workspace:*
```
> The diagnostic stream. Two workspace dependencies and no third-party ones: `core` for `Clock` and `Uuid`, `errors` for `ERROR_CATALOG` and `ErrorNormalizer` — because the level of a logged failure comes from that catalog's `severity`. It sits this low in the graph so `infrastructure`, `auth`, and both apps can all reach it. **`application` may not**, and `check-architecture.mjs` asserts that. See [12](12-application-package.md).

### `@loadbearing/permissions`
```bash
pnpm add --filter @loadbearing/permissions @loadbearing/core@workspace:*
```
> The registry and `CapabilitySet` need only primitives. Deliberately no database and no HTTP: this package must run identically on the server, in the browser, in the worker, and later in the Tauri webview. That identity is what makes "one permission model" true rather than aspirational.

### `@loadbearing/contracts`
```bash
pnpm add --filter @loadbearing/contracts @loadbearing/core@workspace:* @loadbearing/permissions@workspace:* @loadbearing/errors@workspace:* zod@catalog: @orpc/contract@catalog:
```
> `zod` for schemas, `@orpc/contract` for the contract router. It depends on `permissions` because entity methods like `canBeEditedBy()` take a `CapabilitySet`, and on `errors` because a procedure declares the failures it can produce.

### `@loadbearing/application`
```bash
pnpm add --filter @loadbearing/application @loadbearing/core@workspace:* @loadbearing/contracts@workspace:* @loadbearing/permissions@workspace:*
```
> Three workspace dependencies and **zero third-party ones**. That is the point of this package. It talks to everything outside itself through abstract `port/` classes.
>
> If a third-party runtime dependency ever needs adding here, stop and look hard — it almost always means infrastructure leaked into the domain.

### `@loadbearing/infrastructure`
```bash
pnpm add --filter @loadbearing/infrastructure @loadbearing/core@workspace:* @loadbearing/contracts@workspace:* @loadbearing/permissions@workspace:* @loadbearing/application@workspace:* @loadbearing/errors@workspace:* drizzle-orm@catalog: pg@catalog: ioredis@catalog: bullmq@catalog: nodemailer@catalog: @aws-sdk/client-s3@catalog: @aws-sdk/lib-storage@catalog: @aws-sdk/s3-request-presigner@catalog:
```
> **Every concrete adapter, one package.** Postgres and Drizzle in `src/pg/`, Redis in `src/redis/`, S3 in `src/s3/`, BullMQ in `src/bullmq/`, SMTP in `src/smtp/` — one folder per external system, and `ls src/` answers "what does this depend on?".
>
> **Why it depends on `application`:** the ports are abstract classes living there, and every concrete class here extends one. Adapters depend inward on the domain; the domain depends on nothing. `application` never imports this package, so there is no cycle.
>
> `drizzle-kit`, `tsx`, `@types/pg` and `@types/nodemailer` arrived as devDependencies from the scaffold — build-time only, they must not ship. Server-only package.
>
> This is a departure from the architecture docs, which split Postgres into a package of its own; see the note in [00](00-README.md) and the rationale in [15](15-infrastructure-package.md).

### `@loadbearing/auth`
```bash
pnpm add --filter @loadbearing/auth @loadbearing/core@workspace:* @loadbearing/contracts@workspace:* @loadbearing/permissions@workspace:* @loadbearing/application@workspace:* @loadbearing/infrastructure@workspace:* better-auth@catalog:
```
> Better Auth's instance, the session resolver, `PrincipalBuilder`, the capability cache, and API keys. It needs `infrastructure` for both halves it touches: the Drizzle client the adapter wraps, and the Redis cache behind the capability cache. Server-only, and never imported by `apps/web`'s component tree.

### `@loadbearing/composition`
```bash
pnpm add --filter @loadbearing/composition @loadbearing/core@workspace:* @loadbearing/application@workspace:* @loadbearing/observability@workspace:* @loadbearing/contracts@workspace:* @loadbearing/infrastructure@workspace:* @loadbearing/auth@workspace:* @loadbearing/content@workspace:*
```
> The DI root. It is the only package that knows both the abstract ports and every concrete implementation, because wiring them together is its entire job. Server-only.
>
> `observability` is on the list because `Container` constructs the `JsonLogger` and `ContainerConfig` names its `LogLevel`. `contracts` is there for the branded ids the port signatures use — `VectorStore.upsert` and `ActivityReplayReader.since` among them — which `TestContainer`'s fakes cannot override without them ([17](17-composition-container.md)).

### `@loadbearing/asset`
```bash
# Nothing. This package has no dependencies of any kind.
```
> Every binary the product ships. **No React here** — icons are SVG files compiled into a sprite at build time, not components — so this package stays importable by React-free consumers like `content`.
>
> **And no runtime dependency either.** `ImageManifest` is a frozen object, `IconRegistry` is generated, and `font.css` is a file. An earlier draft installed `zod` here and nothing ever imported it. `tsup` does need a `loader` map for the binary imports — see [19](19-asset-package.md).

### `@loadbearing/content`
```bash
pnpm add --filter @loadbearing/content @loadbearing/errors@workspace:* @loadbearing/asset@workspace:* @loadbearing/permissions@workspace:* zod@catalog:
```
> React-free on purpose: `apps/worker` needs copy for digest and escalation emails and cannot import `feature`.
>
> `permissions` is here for **`ModuleKey` and nothing else** — the nav collection names a module, never the permission that gates it. The ESLint ban enforcing that difference is in [05](05-lint-and-format.md) Step 5.3, and it is what makes this dependency safe to have ([20](20-content-package.md) Step 20.6).
>
> **`errors`, not `core`.** This package imports `ErrorCode`, `ErrorEnvelope` and `FieldViolation` — type-only, so nothing from `errors` reaches the runtime — because `ERROR_COPY` is total over the error vocabulary ([20](20-content-package.md)). It imports nothing from `core` at all, and declaring the dependency anyway would put a cycle one honest refactor away now that `core` depends on `errors`.
>
> This is also the one package where `"sideEffects": false` decides whether the design works rather than shaving a kilobyte — see [20](20-content-package.md#sideeffects-false-is-load-bearing-here).

### `@loadbearing/api-client`
```bash
pnpm add --filter @loadbearing/api-client @loadbearing/contracts@workspace:* @orpc/client@catalog: @orpc/contract@catalog: better-auth@catalog:
```
> Depends on `contracts` but **not** on `infrastructure` or `application` — the client knows the shape of the API, never its implementation. `better-auth` is here for its *vanilla* client only (`better-auth/client`), never `better-auth/react`.
>
> **Both `@orpc` packages, and no `core`.** `ContractRouterClient` comes from `@orpc/contract`, not from `@orpc/client`; and nothing in this package imports `@loadbearing/core` — it is isomorphic and carries no `ServerOnly.assert`.
>
> **No `@tanstack/*` and no `react` here, ever.** This package must load in plain Node scripts, integration tests, and any non-React host.

### `@loadbearing/query`
```bash
pnpm add --filter @loadbearing/query @loadbearing/api-client@workspace:* @loadbearing/errors@workspace:* @tanstack/react-query@catalog:
```
> **The only package that may import `@tanstack/*`.** It must not import the router package from the same vendor — routing stays in `apps/web`, which is what lets the Tauri app reuse everything above it.
>
> `errors` is on the list because the retry default reads `ERROR_CATALOG[code].retryable` ([21](21-query-package.md) Step 21.2): retryability is a fact about the code, declared once. **`@orpc/tanstack-query` is deliberately absent** — its query utilities derive keys from the procedure path automatically, which is the job `QueryKeys` exists to do in one place, and having both gives you two key schemes with invalidation that works for one of them. Add `contracts` with the first feature slice, which is what needs its DTO types.

### `@loadbearing/ui`
```bash
pnpm add --filter @loadbearing/ui @loadbearing/asset@workspace:*
```
> Its only runtime workspace dependency, and an acceptable one: `asset` is a leaf with no domain knowledge, so `ui` stays independently testable and extractable. No `contracts`, no `query`, no `content` — everything else arrives as props.

### `@loadbearing/feature`
```bash
pnpm add --filter @loadbearing/feature @loadbearing/ui@workspace:* @loadbearing/query@workspace:* @loadbearing/content@workspace:* @loadbearing/contracts@workspace:* @loadbearing/permissions@workspace:* @loadbearing/errors@workspace:*
pnpm add --filter @loadbearing/feature -D @loadbearing/api-client@workspace:*
```
> Fetches and mutates through `@loadbearing/query`, never through `@loadbearing/api-client` directly.
>
> `errors` is on the list because `SignInForm` branches on `ErrorNormalizer.normalize(error).code`. And **`api-client` is a `devDependency`, deliberately**: the only thing this package takes from it is the `AuthClient` *type*, which `verbatimModuleSyntax` erases — so it is not a runtime edge, and declaring it as one would contradict the ban that defines this package. `packages/ui` does the same with `permissions`.

---

## Step 6.3 — Install and build

```bash
pnpm install
```
> Resolves everything and creates the workspace symlinks.

```bash
pnpm build:packages
```

**Read the build log.** This is the gate that matters. `errors` must complete before `core`, which completes before `permissions`, which completes before `contracts`, then `application`, and so on through `composition`. That ordering is pnpm reading your dependency graph — nothing declares it anywhere — and it is the proof the workspace is wired correctly.

If two packages that should be ordered build in parallel, one of them is missing a `workspace:*` dependency. Fix it now; a missing edge in the graph produces intermittent build failures later that look like flakiness.

---

## The resulting dependency graph

```
errors ── core
 │         ├── permissions ──┐
 │         │                 ├── contracts ──┐
 │         │                 │               ├── application ── infrastructure ── auth ──┐
 │         │                 │               │                                           ├── composition
 │         │                 │               │                                           │
 │         │                 │               └── api-client ── query ── feature          │
 │         │                 │                                    │                      │
 │         │                 └────────────────────────────────────┘                      │
 │         │                                                                             │
 └─────────┴── asset ── content ─────────────────────────────────────────────────────────┘
                          └── ui ── feature
```

Nothing ever points upward. `application` sits at the centre and knows nothing below it.

**`errors` is the root, and `core` is one edge above it.** Both are leaves in the sense that matters — zero third-party dependencies, no Node built-ins, no DOM — so both load anywhere. `errors` genuinely depends on nothing; `core` depends on `errors` alone, because `ServerOnly.assert` throws and there is no such thing in this repository as a bare `Error`.

---

## ✅ Gate

`packages/` contains fifteen directories. Every `packages/*/dist/` holds `index.js` and `index.d.ts`. The build log shows topological ordering.

```bash
pnpm check && pnpm typecheck && pnpm lint && pnpm test
```

All pass. **`pnpm check` comes first on purpose:** the scaffold writes its JSON with `JSON.stringify(…, null, 2)`, which puts short arrays on multiple lines, and Biome formats them inline. Without that step the very next `pnpm lint` reports ~30 formatting diagnostics that are not mistakes.

Commit:

```bash
git add -A
git commit -m "chore(repo): scaffold fifteen packages and wire the dependency graph"
```

Do not proceed until this passes.

---

[← Lint & Format](05-lint-and-format.md) · [`@loadbearing/core` →](07-core-package.md)
