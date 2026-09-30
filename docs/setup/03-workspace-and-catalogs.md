# 03 · Workspace & Catalogs

> `pnpm-workspace.yaml`, version catalogs, and the script topology that replaces Turborepo.

**Delivers:** An installable empty monorepo with topological build ordering that nothing has to declare.

**Prerequisite:** [02 · Repository Skeleton](02-repo-skeleton.md)

---

## Step 3.1 — `pnpm-workspace.yaml`

Create it at the root.

```yaml
packages:
  - "apps/*"
  - "packages/*"
  - "tooling/*"

catalog:
  # ── language & build ──
  typescript: ^5.8.3
  tsup: ^8.5.0
  tsx: ^4.19.0
  rimraf: ^6.0.1
  vitest: ^3.1.4
  "@types/node": ^24.3.0

  # ── lint & format ──
  "@biomejs/biome": ^2.4.15
  eslint: ^9.27.0
  typescript-eslint: ^8.32.1
  sherif: ^1.13.0
  syncpack: ^15.3.2

  # ── contracts ──
  zod: ^4.0.14

  # ── oRPC — pin all four together ──
  "@orpc/contract": ^1.13.7
  "@orpc/server": ^1.13.7
  "@orpc/client": ^1.13.7
  "@orpc/tanstack-query": ^1.13.7

  # ── TanStack Query — peer of @orpc/tanstack-query, which needs query-core >=5.80.2 ──
  "@tanstack/react-query": ^5.101.0

  # ── data & infrastructure ──
  "drizzle-orm": ^0.44.0
  "drizzle-kit": ^0.31.0
  pg: ^8.13.0
  "@types/pg": ^8.11.10
  ioredis: ^5.4.2
  bullmq: ^5.34.0
  "@aws-sdk/client-s3": ^3.700.0
  "@aws-sdk/s3-request-presigner": ^3.700.0

  # ── auth ──
  "better-auth": ^1.6.26

catalogs:
  react:
    react: ^19.1.0
    react-dom: ^19.1.0
    "@types/react": ^19.1.4
    "@types/react-dom": ^19.1.5
```

### Settings live here now

Append to the same file:

```yaml
# ── resolution & safety ──
engineStrict: true
linkWorkspacePackages: deep
preferWorkspacePackages: true
saveWorkspaceProtocol: rolling
strictPeerDependencies: false

# ── which dependencies may run install scripts ──
allowBuilds:
  esbuild: true
  sharp: true
```

**In pnpm 11 this is the only place these can go.** `.npmrc` is auth and registry only, and the `pnpm` field in `package.json` is no longer read at all. If you are porting settings from an older repo, run the `pnpm-v10-to-v11` codemod rather than moving them by hand.

**`engineStrict`** refuses to install on the wrong Node version rather than failing mysteriously three steps later.

**The two `workspace` lines** guarantee `@loadbearing/contracts` always resolves to your local source and never to a registry package that happens to share the name — a real supply-chain concern with an unscoped-looking prefix.

**`strictPeerDependencies: false`** because React 19 peers are still catching up across the ecosystem; revisit it in a year.

**`allowBuilds`** replaces pnpm 10's `onlyBuiltDependencies`. Install scripts are blocked by default; these two legitimately need them. It is a map rather than a list because it also expresses denial — `core-js: false` silences a package you have decided will never build.

The list is short on purpose, and Tauri ([30](30-desktop-app.md)) is why it stays short: a Tauri desktop app adds no native Node modules, because its native half is a Rust crate that Cargo builds. `@tauri-apps/cli` ships prebuilt platform binaries as optional dependencies and runs no install script.

### The desktop and router entries

```yaml
  # ── TanStack Router — apps/web declares it explicitly even though Start brings
  #    it transitively, so a second shell cannot resolve a different version while
  #    rendering the same `feature` components. ──
  "@tanstack/react-router": ^1.170.32

  # ── Tauri — for a desktop shell, if one is built. Not installed by any package
  #    today. Verify against the current 2.x release when you scaffold; the native
  #    half is a Rust crate and needs no allowBuilds entry. ──
  "@tauri-apps/api": ^2.9.0
  "@tauri-apps/cli": ^2.9.0
```

**`@tanstack/react-router` is the one worth explaining.** TanStack Start brings it transitively, so `apps/web` need not declare it — and does, from the catalog, because routing is the one thing a second shell would replace ([21](21-query-package.md)). Two shells resolving different router versions while rendering the same `feature` components is a bad afternoon, and one catalog line removes the possibility before there is a second shell to argue about it with.

Pin the Tauri versions against the current 2.x release when you scaffold rather than trusting the numbers above — same caveat as the prerequisites page in [30](30-desktop-app.md).

### Three defaults you inherit without asking

pnpm 11 turned several protections on by default. Two of them will surprise you at some point, so know about them now rather than at 6pm on a release day.

| Setting | Default | What it does to you |
|---|---|---|
| `minimumReleaseAge` | `1440` (24h) | A version published less than a day ago **will not resolve**. Bumping a catalog entry to a release that landed this morning fails until tomorrow. |
| `blockExoticSubdeps` | `true` | A transitive dependency pointing at a Git URL or tarball is rejected. |
| `verifyDepsBeforeRun` | `install` | `pnpm dev` installs first if `node_modules` is stale, instead of running against the wrong tree. |

**Do not set `minimumReleaseAge: 0` to make an upgrade go through today.** The 24-hour window is the single cheapest defence against the compromised-release attacks that have hit npm repeatedly — a malicious version is usually yanked within hours, and you simply never see it. When you genuinely need a fresh release now (a security patch, most often), add that one version to `minimumReleaseAgeExclude` rather than disabling the rule globally. `pnpm audit --fix` does this for you.

> **`strictDepBuilds` now defaults to `true`.** A dependency that wants to build and isn't in `allowBuilds` **fails the install** instead of printing a warning you scroll past. That is a real improvement — in pnpm 10, ignoring the warning left native modules as inert stubs and produced build errors pointing nowhere near the cause. Now you get told at install time, with the package name.

---

`packages:` tells pnpm which directories are workspace members. `catalog:` is a single source of truth for versions — a package writes `"zod": "catalog:"` rather than a range, so all sixteen upgrade together and cannot drift.

### The catalog is grouped by what a dependency can constrain

Three tiers — never ships, framework-agnostic runtime, framework-scoped — and the tier says which of the eight target frameworks a dependency is able to break. The rule itself, the isomorphic-versus-node-only split inside Tier 2, the quarantine table, and the procedure for adding a dependency all live in [Opinions · Dependencies](../opinions/dependencies.md), because they are consulted every time somebody adds one.

What belongs here is the pnpm mechanics and the three entries with a history.

**Pin all four `@orpc/*` packages to one version line.** They pin `@orpc/shared` **exactly** rather than with a caret, so a skew puts two copies of it in the tree. `syncpack lint` cannot see this — it checks one dependency across packages, not a declared group — which is why it is the fifth assertion in [26](26-hygiene-and-ci.md). Not theoretical: this catalog shipped `@orpc/server` at `^1.13.7` beneath a comment reading *"pin all four together"*, and every check passed.

**`better-auth` is floored above a known auth CVE, deliberately.** The API-key plugin had an authentication flaw (CVE-2025-61928) patched in 1.3.26. You aren't going to use that plugin ([16](16-auth-package.md) explains why), but a floor below a known auth CVE is not a floor worth having. Its export map is also what makes the back-end target list reachable: `./node` covers pure Node, Express, Fastify and Nest, `./next-js` and `./tanstack-start` cover two front-end targets, and the core web `Request`/`Response` handler covers Hono.

> **Do not add `@better-auth/cli` to this catalog to match.** It is published from a different release line and trails the library — 1.4.21 against a 1.6.26 runtime at the time of writing — so its generator emits a schema for fields the installed version does not have. [16](16-auth-package.md) reads the pinned runtime's own table definitions instead, which cannot skew because there is only one version involved.

**React lives in a named catalog, not the default one.** Only four packages consume it, and it moves on a different cadence from everything else. `catalog:react` in a `package.json` reads as a deliberate statement that this package is a React package — and it is always a `peerDependency` there, never a `dependency`, so the consuming app supplies the single copy.

---

## Step 3.2 — Root `package.json`

```json
{
  "name": "loadbearing",
  "private": true,
  "type": "module",
  "devEngines": {
    "packageManager": { "name": "pnpm", "version": "11.21.0", "onFail": "download" }
  },
  "engines": { "node": ">=24.0.0", "pnpm": ">=11.21.0" },
  "scripts": {
    "build": "pnpm -r run build",
    "build:packages": "pnpm --filter \"./packages/*\" run build",
    "build:changed": "pnpm -r --filter \"...[origin/main]\" run build",

    "dev": "pnpm build:packages && pnpm -r --parallel run dev",
    "dev:web": "pnpm build:packages && pnpm --filter @loadbearing/web run dev",
    "dev:worker": "pnpm build:packages && pnpm --filter @loadbearing/worker run dev",

    "typecheck": "pnpm -r run typecheck",
    "lint": "biome check . && eslint .",
    "lint:fast": "biome check .",
    "test": "pnpm -r --parallel run test",
    "clean": "pnpm -r --parallel run clean",

    "format": "biome format --write .",
    "check": "biome check --write .",

    "infra:up": "docker compose -f infra/docker-compose.yml --profile observability up -d",
    "infra:up:analytics": "docker compose -f infra/docker-compose.yml --profile observability --profile analytics up -d",
    "infra:core": "docker compose -f infra/docker-compose.yml up -d",
    "infra:down": "docker compose -f infra/docker-compose.yml --profile \"*\" down",
    "infra:reset": "docker compose -f infra/docker-compose.yml --profile \"*\" down -v",
    "infra:logs": "docker compose -f infra/docker-compose.yml --profile \"*\" logs -f",

    "db:generate": "pnpm --filter @loadbearing/infrastructure run db:generate",
    "db:migrate": "pnpm --filter @loadbearing/infrastructure run db:migrate",
    "db:seed": "pnpm --filter @loadbearing/infrastructure run db:seed",
    "db:studio": "pnpm --filter @loadbearing/infrastructure run db:studio",

    "auth:tables": "pnpm --filter @loadbearing/auth run auth:tables"
  },
  "devDependencies": {}
}
```

### The `infra:*` scripts carry two profiles

`infra:up` starts the four stores **and** the observability stack, because the diagnostic stream is
live from the first adapter written. `infra:core` skips Loki and Alloy when you want a
lighter machine; `infra:up:analytics` adds ClickHouse, which is otherwise never started
([11](11-local-infrastructure.md)).

**`--profile "*"` on `down`, `reset` and `logs` is load-bearing.** Compose only acts on services in
the profiles it was given, so `docker compose down` without it leaves anything profile-gated running
— and `logs -f` without it silently omits those services from the output you are reading to debug
them.

### What the flags actually do

**`pnpm -r run build`** runs the script in every workspace package **in topological order**, derived from the dependency graph. That is the entire Turborepo replacement. You never declare that `contracts` builds after `core`; pnpm reads the `workspace:*` links and works it out.

**`--parallel` is on `dev` and `test`, and off `build`.** Parallel ignores ordering, which is correct for watchers and test runners and catastrophically wrong for builds. `dev` therefore builds packages serially first, then starts watchers in parallel.

**`lint` is not recursive at all.** Biome and ESLint each take the whole repo in one invocation, which is faster than fifteen processes and means no package needs a lint config of its own ([05](05-lint-and-format.md)).

**`clean` does not `rm -rf node_modules`.** Package-level `clean` scripts use `rimraf`, which works on every platform. If you genuinely need to nuke the store, that is a deliberate manual act, not something a script does when someone fat-fingers a tab-complete.

**`build:changed`** uses pnpm's `...[origin/main]` selector to build only packages whose sources changed plus everything downstream of them. It needs full Git history — see the `fetch-depth: 0` note in [26](26-hygiene-and-ci.md).

**`devEngines.packageManager` replaces `packageManager`.** pnpm 11 removed the settings that governed the legacy field (`managePackageManagerVersions`, `packageManagerStrict`, `packageManagerStrictVersion`) in favour of an `onFail` value declared inline. `"onFail": "download"` means a developer with the wrong pnpm on `PATH` gets the right one fetched automatically rather than an error.

> [!IMPORTANT]
> **The version must be exact — a range does not work.** `"version": "^11.21.0"` fails on every pnpm invocation with `Invalid package manager specification in package.json (pnpm@^11.21.0); expected a semver version`, verified on 11.21.0. Bumping pnpm is therefore a deliberate one-line commit, which is arguably the point.
>
> Reproducibility comes from the lockfile regardless: it records `packageManagerDependencies` with the resolved `@pnpm/exe@11.21.0`, so every developer and CI runner gets the same binary.

**There is no `pnpm` field.** pnpm 11 does not read `package.json` for its own configuration. Everything that used to live there is in `pnpm-workspace.yaml`.

---

## Step 3.3 — Install

```bash
pnpm add -Dw typescript@catalog: @biomejs/biome@catalog: rimraf@catalog:
```
> `-D` devDependency, `-w` at the workspace root. `@catalog:` pulls the version from `pnpm-workspace.yaml` rather than pinning a second copy here.

```bash
pnpm install
```

If the install **fails** naming a package whose build was blocked, add it to `allowBuilds` in `pnpm-workspace.yaml` and reinstall — or run `pnpm approve-builds <name>` to have pnpm write the entry for you. Prefix a name with `!` to deny it explicitly.

---

## Optional — repo consistency checks

Two small tools that pay for themselves once there are fifteen packages:

```bash
pnpm add -Dw syncpack@catalog: sherif@catalog:
```

Then add to root scripts:

```json
"deps:check": "syncpack lint",
"repo:check": "sherif -r unordered-dependencies"
```

`syncpack lint` catches a package that pinned `zod` directly instead of writing `catalog:`. (The older `list-mismatches` subcommand is deprecated in syncpack 15.) `sherif` catches missing `workspace:*` protocols, unused dependencies, and packages that dual-declare a dependency and a devDependency. Its `unordered-dependencies` rule is disabled because it forbids grouping a `workspace:*` entry apart from the catalogued ones; drop the `-r` flag if you would rather have strict alphabetical order everywhere. Both run in CI in [26](26-hygiene-and-ci.md). Neither is required for the kit to work.

---

## ✅ Gate

```bash
pnpm install
```

Succeeds. `node_modules/` exists at the root. `pnpm -v` reports 11.x — if you had a different version on `PATH`, `devEngines` fetched the pinned one. `git status` shows `pnpm-lock.yaml` as a new file — commit it.

Do not proceed until this passes.

---

[← Repository Skeleton](02-repo-skeleton.md) · [TypeScript Configs →](04-typescript-configs.md)
