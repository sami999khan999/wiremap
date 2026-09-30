# 05 · Lint & Format

> Biome does the formatting and the bulk of the linting. ESLint stays for six rules that nothing else can express — the ones that _are_ the architecture.

**Delivers:** `@loadbearing/biome-config` and `@loadbearing/eslint-config`, reached from two thin root files. No per-package lint config anywhere.

> Every rule and exemption in this document was verified against Biome 2.5.7 and ESLint 9.39.5 — including the two failure modes called out in Step 5.2.

> This replaces Prettier entirely and reduces ESLint to six rules. If you would rather stay on ESLint + Prettier, everything else in the kit works unchanged — the boundary rules just live in an ESLint config instead of `biome.json`.

**Prerequisite:** [04 · TypeScript Configs](04-typescript-configs.md)

---

## Why two tools

Biome is one Rust binary that formats, organises imports, and lints roughly ten times faster than ESLint and Prettier together. For almost everything here it is a straight replacement, and it deletes a config package, a plugin, and an entire category of Prettier-versus-ESLint conflict.

It cannot express two things this repository depends on:

- **"Constructors must use parameter properties."** Biome has `noParameterProperties`, which bans them — the opposite direction. There is no rule requiring the form, and every class in this codebase is `constructor(private readonly clock: Clock) {}`.
- **"No exported free functions, no exported arrow functions, no static mutable state."** These are AST-shape assertions. ESLint expresses them with `no-restricted-syntax` selectors; Biome has no equivalent rule. GritQL plugins could match them, but you would be writing and maintaining three custom matchers to replace nine lines of config.

So: **Biome for speed and breadth, ESLint for the six rules that hold the architecture up.** The split is not a compromise you tolerate, it is a division of labour — the fast tool runs on every save and every commit, the slow one runs before push and in CI.

> Check Biome's current rule list against your pinned version before writing this config. The gap above is real today; Biome is closing it steadily, and the day `noRestrictedSyntax` or a parameter-property rule lands, Step 5.3 gets shorter. Nothing else in the kit changes when that happens.

---

## Step 5.1 — Biome

```bash
pnpm add -Dw @biomejs/biome@catalog:
```

The configuration lives in a `tooling/*` package alongside the other two, so it keeps its own
`docs/` folder. The root file is a two-line pointer.

**`biome.json`** at the root:

```json
{
  "$schema": "https://biomejs.dev/schemas/2.5.7/schema.json",
  "extends": ["./tooling/biome-config/src/base.json"]
}
```

**`tooling/biome-config/package.json`**

```json
{
  "name": "@loadbearing/biome-config",
  "version": "0.0.0",
  "private": true,
  "files": ["src"]
}
```

> [!IMPORTANT]
> **The link is a relative path, not a package specifier.** `extends: ["@loadbearing/biome-config/src/base.json"]` does **not** resolve — verified against 2.5.7, and it still fails with an `exports` map declaring the file. Biome's config resolver is not Node's.
>
> So this is a workspace member for organisational reasons — config and docs beside the other `tooling/*` packages — not because anything resolves it by name. It has no dependencies, nothing importable, and the root does **not** declare it in `devDependencies`: there is no symlink to create.
>
> Two path questions were verified before splitting the config out of the root, because both would have failed silently: `overrides.includes` globs resolve against the **root** config rather than this file, and `vcs.useIgnoreFile` still finds the root `.gitignore`. Re-check both if you ever move the file.

**`tooling/biome-config/src/base.json`**

```json
{
  "$schema": "https://biomejs.dev/schemas/2.5.7/schema.json",
  "vcs": { "enabled": true, "clientKind": "git", "useIgnoreFile": true },
  "files": { "includes": ["**", "!**/dist", "!**/.output", "!**/migrations"] },
  "formatter": {
    "enabled": true,
    "indentStyle": "space",
    "indentWidth": 2,
    "lineWidth": 100,
    "lineEnding": "lf"
  },
  "javascript": {
    "formatter": { "quoteStyle": "double", "semicolons": "always", "trailingCommas": "all" }
  },
  "assist": {
    "enabled": true,
    "actions": { "source": { "organizeImports": "on" } }
  },
  "linter": {
    "enabled": true,
    "rules": {
      "preset": "recommended",
      "style": {
        "useConsistentMemberAccessibility": {
          "level": "error",
          "options": { "accessibility": "explicit" }
        },
        "useImportType": "error",
        "noProcessEnv": "error",
        "noRestrictedImports": {
          "level": "error",
          "options": {
            "paths": {
              "node:process": "Config is read once in apps/*/src/env.ts and passed down."
            }
          }
        }
      },
      "suspicious": { "noExplicitAny": "error", "noConsole": "error" },
      "complexity": { "noStaticOnlyClass": "off" },
      "performance": { "noReExportAll": "error" }
    }
  }
}
```

**`lineWidth: 100`, not 80.** Constructor parameter properties on `Authorizer`, `PrincipalBuilder`, and every use-case are long by nature; 80 columns wraps every one of them into six lines.

**`lineEnding: "lf"`** is the third leg of the line-ending fix — Git normalises on commit ([02](02-repo-skeleton.md)), `.editorconfig` normalises in the editor, Biome normalises on format. All three, or a Windows machine and a Linux machine produce byte-different files.

**`organizeImports` is an assist action, not a lint rule**, and it replaces `prettier-plugin-organize-imports` with no plugin to install.

**`useImportType`** pairs with `verbatimModuleSyntax` ([04](04-typescript-configs.md)). It is what keeps `@loadbearing/ui`'s import of `PermissionKey` type-only, which is the whole reason `ui` can reference the permission vocabulary without depending on `permissions` at runtime.

**`useConsistentMemberAccessibility` with `"explicit"`** makes every method read `public` or `private`. In an OOP codebase the public surface of a class _is_ its contract, and making it explicit means a reviewer sees the contract without inferring it from what's exported.

**`noStaticOnlyClass` is off on purpose.** It would flag `Uuid`, `Identifiers`, `ProcedurePermissions`, and `PermissionRegistry` — every static-only namespacing class. Those are the intended pattern here, not a smell.

**`noReExportAll` turns "the barrel is the public API" into a checked claim.** It bans `export * from "./clock.js"` and `export * as schema from "./schema.js"`, so every `index.ts` names what it publishes ([Opinions · Imports](../opinions/imports.md)). The rule ships at `warn` and is not in `recommended` — verified with `pnpm exec biome explain noReExportAll` — so it has to be listed here to have any effect. Its one exemption comes in Step 5.2.

**`noConsole` is what keeps the log stream one stream.** Once `@loadbearing/observability` exists, a stray `console.log` is a line nobody can filter, level, sample, or redact — and it is the single easiest thing to add under deadline. The exemptions are enumerated, never a wildcard, and every one of them is a *script* rather than package code: `**/*.mjs`, `packages/infrastructure/{migrate,seed,smoke}.ts` ([15](15-infrastructure-package.md)), `packages/auth/tables.ts` ([16](16-auth-package.md)), and `packages/observability/src/logger/json.logger.ts` — the sink this rule exists to funnel everything into.

**That list is the reason scripts live in a folder rather than loose at `src/` root.** `smoke/`, `migrate/`, `seed/` and `tables/` are each one path in this config; a `smoke.ts` and a `tables.ts` beside `index.ts` would each need their own entry, and the next one would be added by whoever noticed the lint error — which is how a wildcard eventually appears here.

**`noProcessEnv` plus the `node:process` import ban.** The rule catches `process.env.FOO` but not `import { env } from "node:process"`, so both entries are needed to close the door. The exemption for the two `env.ts` files comes in Step 5.2.

**`migrations` is excluded** because Drizzle generates that SQL and reformatting it produces diffs on every generate.

---

## Step 5.2 — The server-only boundary, in Biome

This is the rule that keeps database code out of the browser, and it lives entirely in `overrides`. Append to `biome.json`:

```json
"overrides": [
  {
    "includes": [
      "packages/ui/**", "packages/feature/**", "packages/query/**", "packages/errors/**",
      "packages/content/**", "packages/asset/**", "apps/web/src/**"
    ],
    "linter": {
      "rules": {
        "style": {
          "noRestrictedImports": {
            "level": "error",
            "options": {
              "paths": {
                "@loadbearing/infrastructure": "Server-only. Cross the boundary via @loadbearing/contracts.",
                "@loadbearing/auth": "Server-only. Cross the boundary via @loadbearing/contracts.",
                "@loadbearing/composition": "Server-only. Cross the boundary via @loadbearing/contracts.",
                "@loadbearing/application": "Server-only. Cross the boundary via @loadbearing/contracts.",
                "drizzle-orm": "Server-only dependency. It must never appear in a client bundle.",
                "pg": "Server-only dependency. It must never appear in a client bundle.",
                "ioredis": "Server-only dependency. It must never appear in a client bundle.",
                "bullmq": "Server-only dependency. It must never appear in a client bundle.",
                "better-auth": "Server-only dependency. It must never appear in a client bundle."
              }
            }
          }
        }
      }
    }
  },
  {
    "includes": ["apps/web/src/server/**", "**/*.server.ts"],
    "linter": { "rules": { "style": { "noRestrictedImports": "off" } } }
  },
  {
    "includes": ["apps/*/src/env.ts"],
    "linter": { "rules": { "style": { "noProcessEnv": "off" } } }
  },
  {
    "includes": ["packages/infrastructure/src/pg/schema/index.ts"],
    "linter": { "rules": { "performance": { "noReExportAll": "off" } } }
  }
]
```

**Biome's `noRestrictedImports` takes exact paths, not glob patterns** — which is fine here, because every banned import is an exact package name. If you ever need to ban a subpath family, that rule cannot do it and the ban moves to ESLint.

**Order matters: later overrides win.** The escape hatch must come after the ban, or it does nothing.

**A second client app goes in the *same* block, not a second one.** That is not tidiness — see
the CAUTION below. A separate override matching `apps/desktop/**` would replace the whole
`paths` map rather than adding to it, and every server-only package would be silently unbanned
wherever it matched. A desktop shell ([30](30-desktop-app.md)) is a client: it wants the same
ban list as `apps/web` and, unlike `apps/web`, no escape hatch at all — there is no
`src/server/**` inside a Tauri bundle to exempt. Add its glob to the array above when the
directory exists; a glob matching nothing today is one more line to read and no protection.

> [!CAUTION]
> **Biome replaces rule options across overrides; it does not merge them.** If two `overrides` blocks both match a file and both set `noRestrictedImports`, only the last one's `paths` apply — the earlier map is discarded.
>
> Verified directly: adding a second `packages/feature/**` override that lists only that package's own bans makes `import { Database } from "@loadbearing/infrastructure"` **pass** inside `feature`, with a green lint run. Any override you add for a package already covered above must restate every path it still needs.
>
> This kit sidesteps the problem: there is exactly one `noRestrictedImports` override, and `feature`'s two extra bans live in ESLint instead (Step 5.3) — which they have to, for the reason below.

> [!IMPORTANT]
> **Biome's `noRestrictedImports` flags `import type` exactly like a value import**, and has no type-import exemption. That is why `feature`'s `@loadbearing/api-client` ban cannot live here: `SignInForm` legitimately needs `import type { AuthClient }` ([23](23-feature-package.md)), a type-only import that emits nothing and creates no runtime dependency. Verified against 2.5.7.
>
> Both `feature` bans therefore sit in the ESLint config, where `@typescript-eslint/no-restricted-imports` supports `allowTypeImports: true`. **Biome handles bans that are "this whole module, no exceptions"; ESLint handles the ones needing named-export or type-import nuance** — the same division as `content`'s `PermissionKey` ban ([20](20-content-package.md)).

**The escape hatch is one directory and one filename suffix.** Server-only packages are importable from `apps/web/src/server/**` and any `*.server.ts`, and nowhere else. Everything else crosses the boundary through `@loadbearing/contracts`, which is isomorphic by construction.

**The endpoints moved back to `apps/web/src/route/api/**` in [24](24-web-app.md), and this override still does not list it.** That is deliberate. A Start server route there is three lines that call into `~/server/…`; it never imports `@loadbearing/composition` or `better-auth` itself, so it needs no exemption. **A dead escape hatch is worse than none** — it is the obvious place for the next person to put something that should not be there, and a route file that suddenly wants one is a route file doing work that belongs in `src/server/`.

**The `env.ts` exemption.** Two files in the entire repository may read `process.env`. That is what makes "config arrives through `ContainerConfig`" a checkable claim rather than a convention.

**The last override is the single `export *` exemption**, and it is one filename, not a glob: `packages/infrastructure/src/pg/schema/index.ts` exists so `drizzle-kit` and `drizzle(pool, { schema })` see every table, relation, and enum in the package. It is not an entrypoint — `packages/infrastructure/src/pg/index.ts` republishes it as one namespace — so naming each table there would buy no API-surface control and would reliably drift out of date ([13](13-infrastructure-postgres.md)). Every other barrel in the repository names its exports.

### This is defence one of three

- **`ServerOnly.assert()`** at the top of every server-only barrel ([07](07-core-package.md)) — a runtime tripwire that throws if the module somehow loads in a browser.
- **The CI bundle grep** ([26](26-hygiene-and-ci.md)) — asserts a known Drizzle export string is absent from the built client output.

Three defences sounds excessive until you remember what a leak costs. In a fullstack app, a Drizzle import reaching the client is a security event — connection strings and full table shapes in a public bundle — not a bundle-size regression.

---

## Step 5.3 — ESLint, reduced

```bash
node -e "require('fs').mkdirSync('tooling/eslint-config/src', { recursive: true })"
```

**`tooling/eslint-config/package.json`**

```json
{
  "name": "@loadbearing/eslint-config",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.js",
  "types": "./src/types/index.d.ts",
  "files": ["src"]
}
```

```bash
pnpm add --filter @loadbearing/eslint-config typescript-eslint@catalog:
pnpm add --filter @loadbearing/eslint-config -D eslint@catalog:
```

> `typescript-eslint` is imported at runtime by `src/index.js`, so it is a real `dependency`. **`eslint` is not imported by the config** — it is the host that loads it — so it is a devDependency, present for type resolution in `src/types/index.d.ts` and to satisfy `typescript-eslint`'s peer deterministically.

> [!CAUTION]
> **This package does not supply the `eslint` binary to anyone.** pnpm links executables only from a package's _direct_ dependencies, and this package has no `bin` field. The root `eslint` devDependency is what puts `eslint` on `PATH` — pnpm adds the workspace-root `.bin` to every script it runs. Do not remove it on the assumption this package covers it.

**`tooling/eslint-config/src/index.js`**

```js
import tseslint from "typescript-eslint";

const OOP_PACKAGES = [
  "packages/{core,permissions,errors,observability,contracts,application,infrastructure,auth,composition,api-client,asset,content}/src/**/*.ts",
];

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/.output/**",
      "**/migrations/**",
      // Build configs at a package root. Not inside any package's tsconfig
      // `include`, so projectService cannot resolve them and a type-aware rule
      // fails with a parsing error.
      //
      // Scoped to one directory below the workspace root, NOT "**/*.config.ts":
      // the wider glob also swallows `packages/*/src/**/*.config.ts`, which *is*
      // inside `include` and is ordinary source — `auth.config.ts` and
      // `container.config.ts` went unlinted for exactly that reason.
      //
      // Deliberately NOT "*.config.*" either — that matches eslint.config.js
      // itself, which makes editors warn on every open config file.
      "*.config.ts",
      "*.config.mts",
      "{packages,apps,tooling}/*/*.config.ts",
      "{packages,apps,tooling}/*/*.config.mts",
      "**/*.d.ts",
    ],
  },

  // ── Everything: the typed rules Biome cannot run ──
  {
    files: ["packages/*/src/**/*.{ts,tsx}", "apps/*/src/**/*.{ts,tsx}"],
    extends: [...tseslint.configs.recommendedTypeChecked],
    languageOptions: { parserOptions: { projectService: true } },
    rules: {
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
      "@typescript-eslint/require-await": "error",
      "@typescript-eslint/prefer-readonly": "error",
      "@typescript-eslint/parameter-properties": ["error", { prefer: "parameter-property" }],
      // Biome owns these; don't double-report.
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": "off",
      "@typescript-eslint/consistent-type-imports": "off",
    },
  },

  // ── Non-React packages only: the OOP shape rules ──
  {
    files: OOP_PACKAGES,
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "ExportNamedDeclaration > FunctionDeclaration",
          message: "No exported free functions. Put behaviour on a class (static if stateless).",
        },
        {
          selector:
            "ExportNamedDeclaration > VariableDeclaration > VariableDeclarator > ArrowFunctionExpression",
          message: "No exported arrow functions. Put behaviour on a class (static if stateless).",
        },
        {
          selector: "ExportDefaultDeclaration > FunctionDeclaration",
          message: "No exported free functions. Put behaviour on a class (static if stateless).",
        },
        {
          selector: "ClassBody > PropertyDefinition[static=true][readonly!=true]",
          message: "Static mutable state is banned — it leaks across requests and tests.",
        },
      ],
    },
  },

  // ── feature: bans that need a type-import exemption, which Biome cannot express ──
  {
    files: ["packages/feature/src/**/*.{ts,tsx}"],
    rules: {
      // Off, so the @typescript-eslint variant below owns this rule entirely.
      "no-restricted-imports": "off",
      "@typescript-eslint/no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@loadbearing/api-client",
              allowTypeImports: true,
              message:
                "Every read goes through a defined query in @loadbearing/query. A raw client call inside a component is an uncached read that no invalidation touches.",
            },
            {
              name: "@tanstack/react-router",
              allowTypeImports: true,
              message:
                "Routing lives in apps/web. Pass navigation in as an onNavigate prop or an href string.",
            },
            {
              name: "@loadbearing/content",
              importNames: ["SERVER_CATALOG"],
              message:
                "The email namespace is server-only. Components take a MessageStore; they never build a ContentSource.",
            },
          ],
        },
      ],
    },
  },

  // ── email copy is server-only: it exists for apps/worker's digests ──
  {
    files: [
      "packages/{ui,query}/src/**/*.{ts,tsx}",
      "apps/web/src/**/*.{ts,tsx}",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@loadbearing/content",
              importNames: ["SERVER_CATALOG"],
              message:
                "The email namespace is server-only. Client code takes the default CLIENT_CATALOG, or BundledContentSource on desktop.",
            },
          ],
        },
      ],
    },
  },

  // ── content may name a module, never a permission (see docs/setup/20) ──
  {
    files: ["packages/content/src/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@loadbearing/permissions",
              importNames: ["PermissionKey", "PermissionRegistry"],
              message:
                "Content names a module. ModuleRegistry owns which permission gates it. Import ModuleKey as a type instead.",
            },
          ],
        },
      ],
    },
  },
);
```

**`tooling/eslint-config/src/types/index.d.ts`** — hand-written, because there is no build step to emit one:

```ts
import type { Linter } from "eslint";

// The six rules Biome cannot express, plus the typed rules that need a whole
// TypeScript program. Hand-written because this package has no build step.
declare const config: Linter.Config[];

export default config;
```

**`eslint.config.js`** at the root:

```js
export { default } from "@loadbearing/eslint-config";
```

```bash
pnpm add -Dw @loadbearing/eslint-config@workspace:*
```

**The root declares `@loadbearing/eslint-config` because the root genuinely imports it.** That one-line re-export is a real module resolution, so the symlink has to exist. This is not an exception to "the root declares no workspace packages" — it is the rule, which is **declare what you import**. The root imports this config and nothing else. It must never declare `@loadbearing/core` or `@loadbearing/infrastructure`, because a root declaration hoists a package into the root `node_modules` where every package can reach it regardless of what it declared, which silently dissolves the boundary in Step 5.2.

> [!NOTE]
> ESLint 9 resolves flat config from the **working directory**, not per file — a nearer config is ignored. That is a problem in a per-package setup and a non-issue here: there is exactly one config, at the root, and both `eslint .` and the pre-push hook run from there.

### Why each surviving rule is here

**`recommendedTypeChecked`, not `recommended`.** Type-aware linting is the only way `no-floating-promises` and `no-misused-promises` work. In a codebase where every use-case is `async` and every repository call returns a promise, a forgotten `await` in a `.save()` is a data-loss bug no unit test catches.

> [!IMPORTANT]
> **Biome does ship type-aware `noFloatingPromises` and `noMisusedPromises` — and they do not cover this codebase.** Checked against 2.5.7:
>
> | Shape the promise comes from | Biome |
> | --- | --- |
> | concrete class method, across a file boundary | flagged |
> | `interface` member, across a file boundary | flagged |
> | **`abstract` class member** | **missed** |
>
> Isolated with one class holding both an abstract and a concrete `async` method: the concrete call was flagged, the abstract one was not. So the limit is not file boundaries — Biome resolves those fine — it is the `abstract` modifier.
>
> Every port in this architecture is an abstract class rather than an interface, deliberately ([12](12-application-package.md)). So the entire port surface — and `this.tasks.save(task)`, the canonical missing-`await` bug — is invisible to Biome and visible to ESLint. **Keep the ESLint rules and the `recommendedTypeChecked` extend.**
>
> Both Biome rules are `nursery` in 2.5.7 and this config does not enable nursery, so they are inert. If you ever turn them on, expect double-reporting on concrete methods while abstract members stay ESLint-only — which is worse than leaving them off.

**`parameter-properties`** forces the constructor-injection style the whole system uses, and is the single rule with no Biome equivalent in either direction:

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

This rule is also why `tsx` cannot be replaced by Node's native type stripping ([25](25-worker-app.md)) — parameter properties emit runtime code, so stripping rejects them.

**The three "off" entries are not optional.** Two linters reporting the same violation produces duplicate diagnostics in the editor and teaches people to ignore both. Whenever a rule exists in both tools, Biome owns it — it is faster and it runs on save.

**The OOP selectors** catch the thing the architecture actually depends on:

```ts
// ✗ wrong — behaviour floating free of the data it operates on
export function canReactivate(caps: CapabilitySet, taskId: string) { ... }

// ✓ right — behaviour belongs to the thing that has the data
class CapabilitySet {
  public can(permission: PermissionKey, goalId?: string): boolean { ... }
}
```

Free functions are how a codebase loses its shape. `canReactivate` in a utils file gets copied, then diverges, and now there are two answers to the same permission question. A method on `CapabilitySet` cannot be copied without copying the class.

**The static-mutable-state ban** catches a real production bug. A `static cache = new Map()` on a repository looks fine locally and serves user A's rows to user B under concurrency. `static readonly` is fine; `static` alone is not.

### Why the `email` ban lives here and not in Biome

`@loadbearing/content` is a package every client file legitimately imports — `Translator`,
`MessageStore`, `MessageKey`. The ban is on **one named export**, and Biome's
`noRestrictedImports` has no `importNames`: it bans a module or nothing. That is the division
already stated above — Biome takes bans that are "this whole module, no exceptions"; ESLint
takes the ones needing named-export or type-import nuance. Same shape, same file, as the
`content`/`PermissionKey` ban.

**No `allowTypeImports` on this one.** `SERVER_CATALOG` is a value with no client-side type
use, so the exemption would only widen the hole. It is on the two `feature` entries because
`SignInForm` genuinely needs `import type { AuthClient }` ([23](23-feature-package.md)).

> [!CAUTION]
> **ESLint flat config resolves rules last-match-wins, per rule name — and `packages/feature`
> turns the core rule off.** Its block sets `"no-restricted-imports": "off"` so the typed
> variant can own the rule outright, which means a core-rule ban declared for `feature`
> *anywhere earlier in the array* is silently dead. That is why the `email` ban lists
> `packages/{ui,query}` and the two apps but not `feature`, and why feature's copy of it is a
> fourth entry inside the existing `@typescript-eslint/no-restricted-imports` array. **Any
> future ban on `feature` goes in that array**, never in a new block. This is the ESLint
> analogue of the Biome options-replacement hazard in Step 5.2, and it fails just as quietly.

**Zod schemas and Drizzle tables don't trip these.** They are _data shapes_, not behaviour — declared as `static readonly` class members (Zod) or module-level `pgTable` consts (Drizzle). Neither matches a selector above.

**`packages/{ui,feature,query}` and `apps/*` are excluded from the OOP block** — React components and hooks are functions by contract with the framework. That exclusion is the `OOP_PACKAGES` glob, and it is the only place in the repo where the React/non-React split is written down. It is also why `MessageProvider` and `useMessages` ([23](23-feature-package.md)) are exported functions without an exemption: `feature` is simply not in the glob.

**`packages/content` *is* in the glob, and two things in it look like violations.** Neither is,
and both are worth naming before someone "fixes" them:

- **The catalog's loader arrows** ([20](20-content-package.md)) sit inside an object literal.
  The banned selector is `ExportNamedDeclaration > VariableDeclaration > VariableDeclarator >
  ArrowFunctionExpression` — a chain of *direct* children, matching `export const x = () => …`.
  An arrow that is a property value has an `ObjectExpression` parent and does not match.
- **`MessageStore`'s mutable fields** are instance members. The static-state selector is
  `ClassBody > PropertyDefinition[static=true][readonly!=true]`, and per-request instance state
  is exactly what that rule pushes you toward.

**The `ignores` list covers what `projectService` cannot resolve.** TS config files and hand-written `.d.ts` sit outside every package's tsconfig `include`, so a type-aware rule fails on them with a parsing error rather than a lint finding. Deliberately `**/*.config.ts` rather than `*.config.*` — the wider glob also matches `eslint.config.js` itself, which makes editors report *"File ignored because of a matching ignore pattern"* on every config file you open.

---

## Step 5.4 — Root scripts

```json
{
  "scripts": {
    "format": "biome format --write .",
    "check": "biome check --write .",
    "lint": "biome check . && eslint .",
    "lint:fast": "biome check ."
  }
}
```

**`biome check` is lint plus format plus import organisation in one pass**, which is why `lint` runs it rather than `biome lint`.

**`lint:fast` exists for the pre-commit hook.** The hook runs Biome only; ESLint runs on pre-push and in CI ([26](26-hygiene-and-ci.md)). A hook that takes ten seconds gets disabled; one that takes half a second stays on, and a check that runs is worth more than a thorough check that doesn't.

**No `-r --parallel`.** Both tools take the whole repo in one invocation, which is faster than fifteen processes and means no package needs a lint config of its own.

---

## What this removed

- `tooling/prettier-config/` — the package, its config, and its plugin dependency.
- `prettier.config.js` at the root.
- `tooling/eslint-config/src/{base,oop,react}.js` — three entrypoints collapsed to one config with file globs.
- **`eslint.config.js` in every package.** Packages now have **three** config files at their root, not four ([06](06-package-anatomy.md)).
- The `@loadbearing/eslint-config` devDependency in every package — only the root declares it now.
- The `lint` script in every package.
- The advice about scaffolding with `base` and switching later. With one root config keyed on globs, there is nothing to switch.

---

## ✅ Gate

```bash
pnpm exec biome --version
pnpm exec eslint --version
pnpm check
```

All three run without crashing. There is nothing to lint yet; the real check arrives in [07](07-core-package.md).

Do not proceed until this passes.

---

[← TypeScript Configs](04-typescript-configs.md) · [Package Anatomy →](06-package-anatomy.md)
