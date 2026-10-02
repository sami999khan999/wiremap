# 29 · Boundaries

> A folder-by-folder account of what every directory in the repository is for, and one small feature
> traced through all of it.

**Delivers:** Nothing new. This is a reference — but it is the one to read before writing your first
feature.

**Prerequisite:** [28 · Folder structure](28-folder-structure.md)

---

## Naming lives in `docs/opinions/`

Every rule for *what to call a thing* — files, folders, classes, methods, permissions, database
objects, comments — moved out of this document into [`docs/opinions/`](../opinions/index.md). That
split is the same one the repository already makes between `docs/setup/` and a package's `docs/`:
**the setup sequence is walked once, a reference is consulted continually**, and naming rules are
the most consulted thing here.

| Page | Decides |
|---|---|
| [Files](../opinions/files.md) | Casing, role suffixes, one class per file, where tests go |
| [Folders](../opinions/folders.md) | What `src/` looks like, role folders vs subject folders |
| [Imports and exports](../opinions/imports.md) | `index.ts`, `import.ts`, the three import rules |
| [Dependencies](../opinions/dependencies.md) | The four tiers, which layer may name a framework |
| [Classes and methods](../opinions/classes.md) | Class-name grammar, banned suffixes, method vocabulary |
| [Vocabulary](../opinions/vocabulary.md) | Permissions, procedures, events, queues, contracts, database |
| [Data and scale](../opinions/data-and-scale.md) | Which store owns which data, what is derived, what to build now |
| [Simplicity](../opinions/simplicity.md) | How much structure to build; performance is part of the goal |
| [Comments](../opinions/comments.md) | Line comments only, two lines, where the reasoning goes |

**The test all of them serve:** given a feature name and a layer, you should be able to write the
file path, the folder, and the class name without looking anything up.

What remains below is *boundaries* — which folder a thing belongs in, and what it is not allowed to
reach.

---

# Part 1 — What every folder is for

Walked top to bottom, in the order the tree in [28](28-folder-structure.md) lists them. For each folder: what belongs in it, what does not, and the sign that something landed in the wrong place.

---

## 1.1 The four root directories

### `apps/`

- **Holds** the three deployable shells — `web`, `worker`, and `desktop`. Each one reads configuration, mounts a transport, and composes components that live elsewhere.
- **Is the only place `process.env` is read.** Exactly two files repo-wide — `web` and `worker` — and CI asserts it. `desktop` is not a third: a webview has no Node runtime, so it reads `import.meta.env` and could not reach a server secret if it tried ([30](30-desktop-app.md)).
- **Is the only place `@tanstack/react-router` appears.** Routing is app-shaped, not product-shaped.
- **Never holds** business logic, database schema, permission decisions, or domain errors.
- **Should be deletable.** The test: if you threw away `apps/` entirely, could you rebuild it in a week against the same `packages/`? If not, something drifted upward that belongs below.
- **Smell:** any app directory growing past a few hundred lines of non-route code.

### `packages/`

- **Holds everything that matters** — primitives, permissions, contracts, use-cases, adapters, components. Fifteen packages, each with one job.
- **Knows nothing about which web framework you use.** No package imports `@tanstack/react-start`, and only one imports `@tanstack/*` at all.
- **Never reads its own configuration.** Every package receives what it needs through a constructor. That is what makes the same `Container` work in a web server and a worker.
- **Smell:** a package reaching for `process.env` because "it just needs one value."

### `tooling/`

- **Holds three workspace packages** that configure the build: `tsconfig`, `biome-config`, and `eslint-config`. Plus `scripts/`, which holds the architecture assertions.
- **`biome-config` is the odd one out**: it is a workspace member for organisation only. The root `biome.json` reaches it by *relative path*, because Biome's `extends` cannot resolve a package specifier — so unlike the other two, the root does not declare it as a dependency.
- **Is consumed by every other package** but imported at runtime by none. These are `devDependencies` and config `extends` targets only.
- **Is platform-owned.** Changes here affect all fifteen packages, so they go through whoever owns the repo rather than whoever is shipping a feature.
- **Never holds** runtime code, shared utilities, or "helpers that everything needs." Those want a real package.
- **Smell:** anything under `tooling/` appearing in a `dependencies` block.

### `infra/`

- **Holds descriptions of running services**: `docker-compose.yml`, and the Postgres init SQL that creates extensions.
- **Is development-shaped.** It is not your production deployment; it is the local approximation of it. The mapping table in [11](11-local-infrastructure.md) says which managed service replaces each container.
- **Never holds** application code of any kind. Nothing in `packages/` or `apps/` imports anything from here — these are [Tier 0](../opinions/dependencies.md) dependencies, provided by the deployment and reached over a protocol the code was going to speak anyway.
- **No profiles in lite.** Five containers run, and all of them start with `pnpm infra:up`. A store ported back from [`docs/scale/`](../scale/index.md), such as [Logs](../scale/logs.md), may come with a profile of its own. The seam being implemented and the store being started are two separate decisions ([Data and scale](../opinions/data-and-scale.md)).
- **Documented in [`docs/infra/`](../infra/index.md)** — one reference page per file and the service it configures.
- **Smell:** a `.ts` file, or a `LOKI_URL` in `.env.example` — the moment application code names the log platform, the platform stops being swappable by config.

---

## 1.2 Root files

- **`pnpm-workspace.yaml`** — three jobs in one file: workspace membership, the dependency version catalog, and every pnpm setting. Under pnpm 11 this is the *only* place settings can go.
- **`package.json`** — scripts, `devEngines.packageManager`, and devDependencies. It declares the two `tooling/*` configs it imports and no `packages/*` member, ever. A root declaration hoists a package into the root `node_modules` where everything can reach it, which quietly disables the boundary the whole architecture rests on.
- **`.nvmrc`** — the Node major. CI reads this same file, so the two cannot drift.
- **`.env.example`** — the complete variable list. It is documentation as much as a template: the two `env.ts` schemas are the enforcement, this is the discoverable copy.
- **`.gitattributes`** — line-ending normalisation. One of three defences, alongside `.editorconfig` and Prettier's `endOfLine`.
- **`commitlint.config.js`** — the closed scope list. Adding a package means adding a scope; a rejected commit is the reminder.
- **`biome.json`** — two lines, extending `tooling/biome-config/src/base.json`, which holds formatting, import organisation, the fast lint rules, the server-only import boundary, and the `env.ts` exemption.
- **`eslint.config.js`** — a one-line re-export of `@loadbearing/eslint-config`, which holds the six rules Biome cannot express.
- **`.husky/`** — three hooks. `pre-commit` runs Biome on staged files only; `pre-push` runs the slow ESLint pass; `commit-msg` runs commitlint. Nothing whole-project goes in `pre-commit` — a hook that takes ten seconds gets disabled.
- **`.github/workflows/`** — the `verify` job. Services, install, build, typecheck, lint, test, architecture greps.

---

## 1.3 The shape every package has

- **`package.json`** — name, `exports` map, scripts. The `exports` map points at `src/index.ts` and nothing else, which is what stops consumers reaching into internals. It carries the `development` condition so Vite can resolve to source in dev.
- **`tsconfig.json`** — four lines, extending one of the `tooling/tsconfig` bases.
- **`tsup.config.ts`** — entry, `dts: true`, ESM only, `target: es2024`.
- **No lint config.** Both linters run once from the root, keyed on globs. A package's specific bans — `feature` blocking `api-client`, the OOP rules applying only to non-React packages — are `overrides` blocks in `biome.json` and `files` blocks in `eslint.config.js`. Keeping them central means a package cannot opt itself out of a rule that exists to constrain it.
- **`src/index.ts`** — the public surface. Re-exports only, never logic. Server-only packages call `ServerOnly.assert()` on line two.
- **`src/import.ts`** — the outside surface. Every workspace-package and npm import the package takes, re-exported to the rest of `src/`. External specifiers only, never a relative one. Absent when the package depends on nothing outside itself.
- **Those two files are all `src/` holds.** Everything else lives in a folder named after its role — `error/`, `catalog/`, `registry/`, `transport/`, `primitive/` — or, where the contents repeat once per feature slice, after the subject. The vocabulary and the choice between the two are in [Opinions · Folders](../opinions/folders.md).
- **`docs/`** — reference documentation for the package. Exactly two files at its root: `meta.json` (sidebar title, description, page order) and `index.md` (the overview). **Every other page lives in `docs/reference/`**, which carries its own `meta.json` for the group label and ordering. Plain Markdown with YAML frontmatter, **never MDX**, so it renders on GitHub and can be picked up by a documentation site later without rewriting content. Callouts use GitHub alert syntax. Not in `files`, so it never ships.

**Every subfolder inside `src/` also has an `index.ts`.** That is what lets you move a file within a folder without touching a single import elsewhere.

**`docs/` is reference, `docs/setup/` at the root is build order.** Different audiences and different shapes: the root sequence is walked once, a package's docs are consulted continually. Keep them apart.

---

## 1.4 Inside `packages/core`

- **`primitive/`** — the whole package. `Clock`, `Result`, `Uuid`, `ServerOnly`, and nothing else. If `core` ever needs a *second* folder, it has grown past its job.
- **Holds** things every package might need that belong to no feature.
- **Depends on `@loadbearing/errors` and nothing else, ever.** `ServerOnly.assert` throws, and nothing in this repository throws a bare `Error` ([09](09-errors-package.md) Step 9.3). `errors` is the root of the graph, so the edge is acyclic and `core` stays isomorphic.
- **Never holds** a domain noun. `TaskId` is a `contracts` concern, not a primitive.
- **Smell:** an import of any workspace package other than `errors`, or of any third-party package at all.

---

## 1.5 Inside `packages/errors`

- **`error/`** — `app.error.ts` and one subclass per code that carries context. `AppError` sits *in* this folder, not above it: it carries the `.error.ts` suffix, so it belongs where every other `.error.ts` file is.
- **`catalog/`** — the closed `ErrorCode` vocabulary, merged from team-owned fragments exactly as `permissions/catalog/` is. `ErrorMeta` is transport-agnostic: `retryable` is a fact about the code, which is why `query`'s retry callback and the worker's BullMQ config can read the same field and cannot disagree.
- **`transport/`** — `HTTP_STATUS`, and the only place in this package that knows HTTP exists. `@loadbearing/application` may **not** import it; ESLint bans the name for that package specifically, because a status code is a transport concern and the discipline that keeps the transport swappable is that the domain layer has never heard of the number.
- **`normalizer/`** — `ErrorNormalizer`, the boundary every thrown value crosses before it is transported, logged, or rendered. It matches structurally rather than with `instanceof`, because two copies of this package in one process produce two class identities.
- **No `import.ts`.** This package is the root of the dependency graph and takes nothing from outside itself — not even `zod`, which is why `SchemaIssue` is declared structurally.
- **Carries no prose.** `Error.message` is the code. Every word a user reads lives in `@loadbearing/content` keyed by that code ([09](09-errors-package.md), [20](20-content-package.md)).
- **Smell:** a message string; an HTTP status outside `transport/`; a dependency in `package.json`.

---

## 1.6 Inside `packages/observability`

- **`catalog/`** — the closed `EventCode` vocabulary and its per-code policy: what level a code is, and whether it is sampled. Fragment-per-slice, the same team-ownership seam as `permissions/catalog/` and `errors/catalog/`.
- **`event/`** — type-only. `EventShape` declares what each code carries, so a misspelled field is a compile error and a token cannot be logged unless somebody declared a field for it where a reviewer sees it.
- **`logger/`** — the seam and its sinks. `JsonLogger` is **the one file in the repository allowed to call `console`**; Biome's `noConsole` is an error everywhere else, and this is the sink that rule exists to funnel everything into.
- **`primitive/`** — `LogLevel` and `Correlation`. Same folder name as `core`'s, holding the same kind of thing.
- **The level is in the catalog, never at the call site.** There is no `log.error(...)` — `emit("queue.job.failed", …)` is an error because the catalog says that code is, so it cannot be `info` in one adapter and `error` in another.
- **`Logger` returns `void`, not `Promise<void>`** — the one deliberate break from the all-async port rule. An async logger makes a log line a scheduling decision and lights up `no-floating-promises` at every call site. Losing a line in a crash is acceptable here, which is exactly what separates it from `ActivityLogger`.
- **Nothing in `packages/application` may import this.** The domain layer records business facts or throws; diagnostics belong to the adapters. `check-architecture.mjs` asserts it.
- **Smell:** a free-form message string; a `log.emit` inside a use-case; a `catch { log }` in a consumer, which turns a retryable failure into silent data loss.

---

## 1.7 Inside `packages/permissions`

- **`registry/`** — the two lookup classes. `permission-registry.ts` is the vocabulary, `module-registry.ts` is the nav gate. Both are singletons over a frozen, module-level view of their catalog.
- **`capability/`** — `capability-set.ts`, the resolution algorithm. It imports `../registry/permission-registry.js` by file rather than through that folder's barrel, because the barrel also loads `module-registry.ts`, which imports this folder back.
- **`catalog/`** — one file per feature slice, each declaring that slice's permission keys, plus a platform-owned `index.ts` that merges them. **This folder is the team-ownership seam**: one team, one file, no merge conflicts in a shared list.
- **`gate/`** — the same fragment pattern for module gates, which is what nav items are allowed to reference.
- **`route/`** — the same fragment pattern for destinations. It lives here rather than in a shell because a router's generated route tree cannot be the shared source: a worker process has none, and web and desktop generate different ones ([08](08-permissions-package.md)).
- **The whole package is synchronous and pure.** No I/O, no database, no `async`. That is not a stylistic choice — it is what lets the identical class run in the oRPC handler, the React component, the worker, and the desktop app and give the same answer.
- **Smell:** an `async` method, or an import of anything outside `core`.

---

## 1.8 Inside `packages/contracts`

- **`primitive/`** — the shared vocabulary every subject uses: branded identifiers, `Envelope`, `Pagination`. Same folder name as `core`'s and `content`'s, holding the same kind of thing.
- **`<subject>/`** — one folder per domain subject (`task/`, `goal/`, `lead/`). Three files each: the Zod shapes, the entity with behaviour, the oRPC procedures. **None ship** — the kit delivers the seam, not a sample tracker.
- **`procedure/`** — the merge point for every slice's `.procedures.ts`, producing `contract` and `AppContract`. Named `procedure/` rather than `router/` because `apps/web/src/server/orpc/` holds the routers that *implement* this contract, and one word for both would be a collision.
- **`catalog/`** — one fragment per subject, mapping procedure path → permission key, plus the index that merges them. Same name and same pattern as `permissions/catalog/` and `errors/catalog/`. Separate from the subject folders because it is a *cross-check*, not part of the subject's definition.
- **`registry/`** — `ProcedurePermissions`, the lookup class over that catalog. Same name and same shape as `permissions/registry/`.
- **`catalog/` is not re-exported from the barrel.** Its merged map is an input to `registry/` and to the coverage test; nothing outside the package reads it. That is the private layer a named barrel buys.
- **Adding a subject is three edits**: `procedure/index.ts`, `catalog/index.ts`, and the barrel.
- **The whole package is isomorphic.** It is imported freely by both server and browser, which is why nothing in it may perform I/O.
- **Smell:** an entity method that fetches something. Entities carry behaviour (`isLockedFromAssignee()`), never data access.

---

## 1.9 Inside `packages/application`

- **`error/`** — the domain error hierarchy. Each carries a `code` string, which is the *only* thing the transport layer maps. No HTTP status codes anywhere in this folder.
- **`port/`** — abstract classes for cross-cutting infrastructure: cache, storage, queue, vector store, embeddings, sessions, activity, email, maintenance, outbox, sharding, unit of work. One file per capability, all abstract, zero implementations — and every one bound in `Container`.
- **`<slice>/`** — one folder per feature slice, holding that slice's use-cases, its policies, **and its repository port**.
- **Repository ports live in the slice, not in `port/`.** `port/` is for capabilities the whole system shares; `TaskRepository` is meaningful only next to the use-cases that need it. Putting it in `port/` would make that folder grow by one file per feature forever.
- **Every use-case has one public method, `execute(principal, input)`**, following load → authorize → work → persist.
- **This package imports no framework at all.** `check-architecture.mjs` greps for `@orpc`, `@tanstack`, `drizzle-orm`, `ioredis`, `bullmq`, `@aws-sdk`, `better-auth` and fails the build on any hit.
- **Smell:** `import { sql }`, or a use-case that skips step two.

---

## 1.10 Inside `packages/infrastructure/src/pg`

The Postgres side gets its own section because it is the largest folder in the package and the only one with sub-structure. It is a peer of `redis/` and `s3/`, not a package — see [13](13-infrastructure-postgres.md) for why the two were merged.

- **`drizzle.config.ts` and `migrations/`** sit at the **package** root, above `src/`, because they are build-time artefacts rather than shipped code. Migrations are generated and committed; `db:push` is never used.
- **`primitive/`** — `database.ts` (one pool, `Database`, `DrizzleClient`), `database-cluster.ts` (every physical node, indexed; **the only place in `src/` that writes `new Database(`**) and `base.repository.ts` (the tenant `WHERE` clause, the declared placement, and the transaction handle every repository inherits).
- **`schema/`** — every table, one `*.schema.ts` per subject, plus the `index.ts` barrel that is the single Drizzle Kit entry. `check-architecture.mjs` asserts every domain table declares `organization_id`, and that the barrel names every file beside it.
- **`repository/`** — every concrete adapter, one file each, **flat**. They sit together rather than in a folder per subject because they are all the same kind of thing: a class extending `BaseRepository`, reading `schema/`, running inside `TransactionScope`. A folder holding one file is a path, not a subject ([Simplicity](../opinions/simplicity.md)).
- **`transaction/`** — `TransactionScope`, the `AsyncLocalStorage` every repository reads; `ShardScope`, the second one holding `{ key, node }`; and `PgUnitOfWork`.
- **`migrate/` and `seed/`** — scripts, not module code. Neither is exported from a barrel, both are exempt from `noConsole`, and the seed is idempotent: the owner role's grants come from `PermissionRegistry.all()` so they cannot fall behind the catalog.
- **The tables are grouped by subject and the adapters are not**, and the asymmetry is deliberate: two tools require one entry naming every table, and nothing requires one naming every repository. A slice's files therefore land in two directories — `schema/lead.schema.ts` and `repository/pg-lead.repository.ts` — so a `CODEOWNERS` line per team needs both globs. `activity_log` is partitioned by month and written inside the caller's transaction, which is what makes an audit row and its state change commit together ([13](13-infrastructure-postgres.md)).
- **Repositories fetch and persist. They never decide.** A `capabilities.can()` call in this package means an authorization decision escaped the use-case.
- **Every repository declares one placement, and `catalog` / `local` / `routed` is the whole vocabulary.** The word names where a table lives, not what it holds: `catalog` is what a principal is built from before a key is known, `local` is present on every node, `routed` is everything a tenant produces and is the default. One repository, one placement — a CI assertion, and the reason a recipient list whose ids live on a routed table reads them there first and resolves them through `PgNotificationRecipientReader`, rather than joining across the line.
- **"Shard" is a physical node and nothing else.** There is no virtual shard, no bucket, no range: `shard_assignments` maps one key to one node. A `shardKey` is opaque text, and `node` is a number.
- **Scoping by `organization_id` is not deciding.** The tenant filter is the boundary permissions are evaluated *inside*, not a permission check, so it belongs here — inherited from `BaseRepository` rather than written per method. A repository query with no tenant predicate is the bug; a repository asking `can()` is the other bug.
- **Smell:** a permission check, or a non-Postgres concern inside `pg/`.

---

## 1.11 Inside `packages/infrastructure`

- **`redis/`** — the connections. **Two connections, one instance in lite.** Both URLs point at one Redis under `noeviction`, because a queued job is derived from nothing and must never be evicted. So every cache key carries a TTL. One class still owns which connection is which, and they are configured differently besides (`maxRetriesPerRequest: null` for BullMQ, a key prefix only for the cache). Splitting them is an `.env` change — [Split Redis](../scale/split-redis.md).
- **`pg/`** — Postgres and Drizzle, covered in §1.10 above. The one folder here with sub-structure.
- **`s3/`** — `S3StorageGateway` and `StorageKey`. The gateway never takes a bucket in a method signature; the bucket is configuration.
- **`bullmq/`** — `QueueName` (a closed union) and `BullMqQueuePublisher`.
- **`openai/` and `gemini/`** — `OpenAiEmbeddingProvider` and `GeminiEmbeddingProvider`. Neither is built under `EMBEDDING_PROVIDER=none`, where search is lexical.
- **`smtp/`** — `SmtpEmailSender`, behind the `EmailSender` port. SMTP rather than a provider's HTTP API, so swapping vendors is a URL rather than a new adapter.
- **`unified/`** — `UnifiedMarkdownRenderer`, behind the `MarkdownRenderer` port.
- **One folder per external system this package speaks to**, named after the technology, so `ls src/` answers the question “what does this depend on?”. That is what makes a vendor swap visibly local: you delete `s3.storage-gateway.ts` and write `azure.storage-gateway.ts`, and `s3/index.ts` is the only other file that changes.
- **A system nothing reaches from code gets no folder.** A log collector is real infrastructure and would have no home here: it tails stdout, and nothing in `packages/` addresses it. Lite runs none. The big kit's Loki was the near-miss — a reader over `query_range` gave it a folder with no writer. [Logs](../scale/logs.md) has both.
- **Smell:** a folder for something that is not an npm dependency.
- **Contains no business logic.** These are adapters: translate a port call into a vendor call, translate the response back.
- **Smell:** a domain noun in a method name, or one folder reaching into another's files.

---

## 1.12 Inside `packages/auth`

- **`src/` root files** — `AuthConfig` and `AuthFactory`. The factory is the only place Better Auth is constructed.
- **`session/`** — `BetterAuthSessionResolver`, implementing the `SessionResolver` port, and `MembershipReader`, the port that answers which organization a new session belongs to. This is the wall: Better Auth types stop here.
- **`principal/`** — `PrincipalBuilder` (any credential → a `Principal`) and `CapabilityCache` (Redis, short TTL, invalidated explicitly on every grant change — the TTL is a backstop, not the mechanism).
- **`apikey/`** — hashing and resolution. The resolver re-intersects a key's grants with the *issuer's current* capabilities on every request, so revoking a person's access revokes their keys' access at the same instant.
- **The rest of the system never sees Better Auth.** Transport calls `PrincipalBuilder`; use-cases receive a `Principal`. Swapping the auth library rewrites this package and nothing else.
- **`tables/`** — a script, not module code: it prints the schema the pinned Better Auth version expects, to be diffed against `packages/infrastructure/src/pg/schema/auth.schema.ts` after an upgrade. Never exported, never built into `dist/`.
- **Smell:** `better-auth` imported from any other package. Also `@better-auth/cli` in any `package.json` — it trails the library's release line, and a generator behind the runtime writes a schema that is wrong where it matters.

---

## 1.13 Inside `packages/composition`

- **`container/`** — `ContainerConfig` (the shape), `Container` (the wiring), `TestContainer` (the same wiring with fakes). **`fake/`** — one double per port in `application/src/port/`, off the barrel.
- **`TestPorts` is a compile-time completeness check.** One entry per abstract port class, so adding a port stops this package compiling until it has a double. That is why it lives in `src/` rather than `tests/`: the check has to be `tsc`'s.
- **Constructs every concrete class exactly once.** This is the only file in the repository that knows `PgVectorStore` and `VectorStore` are related.
- **Exposes ports as abstract types**, so a consumer holding `container.vectorStore` cannot accidentally depend on the concrete class.
- **Contains no logic.** An `if` that is not about configuration means something crept in.
- **Disposes in reverse construction order**, so the pool closes after the things using it — one `cluster.close()` for every node, last.
- **`shard/`** — `OrganizationShardingStrategy`, `keyOf(principal)`. One class, and the fork's swap point: a deployment sharding on region edits this file and three others, listed in [sharding](../../packages/infrastructure/docs/reference/sharding.md).
- **`placed()` and `eachShard()` are the only two ways work is placed**, and they live here rather than on a port because choosing a key is a composition decision. Everything downstream reads the scope.
- **Smell:** the word "if" anywhere except reading a config flag; lazy instantiation, which hides a construction failure until the first request.

---

## 1.14 Inside `packages/api-client`

- **`client/`** — `ApiClient`, with a private constructor and two factories: `overHttp` (browser and desktop) and `inProcess` (SSR, no network hop).
- **`auth/`** — `AuthStrategy` (abstract) and its two implementations, plus `TokenProvider` (abstract) and `AuthClient`. This folder is the entire difference between a web client and a desktop client.
- **Never imports `react` or `@tanstack/*`.** It must load in plain Node scripts, integration tests, and any future non-React host.
- **Names no DOM type.** `RequestCredentials` is restated locally and `fetch` is reached off `globalThis`, because `library.json` loads `lib: ["ES2024"]` and giving this package the DOM lib would declare `document` in something that has to run in Node.
- **Caches nothing.** Caching is `query`'s job, and the split exists because the two change for different reasons — this package when the backend changes, `query` when product behaviour does.
- **Smell:** a hook, or a `queryKey`.

---

## 1.15 Inside `packages/asset`

- **`image/`** — a closed `ImageKey` union plus the files themselves under `file/`. A content record naming a missing image is a compile error.
- **`icon/`** — source SVGs under `svg/`, plus the generated `sprite.svg` and `IconRegistry`. The sprite is gitignored; `build-sprite.mjs` regenerates it and fails the build on any hardcoded `fill` or `stroke`, because a hardcoded colour is an icon that breaks in dark mode.
- **`font/`** — self-hosted variable fonts and the `@font-face` CSS. Self-hosted so there is no third-party request on first paint.
- **`build-sprite.mjs`** and **`asset.d.ts`** sit above `src/` — build tooling, not shipped code. The `.d.ts` therefore has to be named in the tsconfig `include`, or it is silently outside the program.
- **The sprite is gitignored; the registry is committed.** Output that the type system depends on has to survive a fresh clone, or nothing typechecks before a build. And because the registry lands in a linted tree, the generator owns its formatting — Biome collapses a short array inline, so the generator has to as well or every icon addition is a diff in two places.
- **Holds only assets you ship.** User uploads are S3's problem and never appear here.
- **Smell:** a file that differs per environment.

---

## 1.16 Inside `packages/content`

- **`message/`** — short keyed strings in three tiers. `namespace.ts` derives the closed `MessageKey` union from **type-only** imports of the English files, so the union stays complete while the runtime data splits; `catalog.ts` maps locale × namespace to a dynamic-import loader; `catalog.server.ts` adds `email`, which is server-only. English files are `as const`; every other locale is `NamespaceBundle<N>` — `Partial<>` **per namespace**, not per locale, so a Bengali file cannot hold a key from a namespace it does not name. A typo in a component is still a compile error, and so is a key from a namespace that component never declared.
- **`document/`** — long-form editorial content with a schema and an entity.
- **`collection/`** — repeating records, including `nav/`. Nav items carry a **module**, never a permission — a `files`-scoped block in the root ESLint config bans importing `PermissionKey` here, because content authors should not be making authorization decisions.
- **`media/`** — `MediaResolver` (abstract) and `StaticMediaResolver`, which turns an `ImageKey` into a URL by reading [19](19-asset-package.md)'s manifest. Async in the seam, synchronous in the implementation, for the same reason as everything else here.
- **`message/error-copy.ts`** — the only place in the repository where a failure gets words. `ERROR_COPY` is `Record<ErrorCode, ShellMessageKey>`, so it is total over the error vocabulary *and* restricted to the two namespaces every snapshot guarantees; `ErrorCopy` is the class an error page calls. This package depends on `@loadbearing/errors` for those types, on `@loadbearing/asset` for `ImageKey`, on `@loadbearing/permissions` for `ModuleKey` **and nothing else from it**, and on `@loadbearing/core` for nothing — see [20](20-content-package.md).
- **`source/`** — `content-source.ts` (abstract) and `static-content.source.ts`. The abstract class is the seam a CMS slots into, and `ContentSource.resolve()` is `protected static` so "`common` and `error` are always in the snapshot" is a property of the seam rather than of each implementation.
- **`translator/`** — `Translator` and `MessageSnapshot`: `{name}` interpolation with no library, and the English-underneath-the-locale fallback.
- **`primitive/`** — `locale.ts`. Same folder name as `core`'s, holding the same kind of thing: a value type with no layer role.
- **`source/content-source.ts`** — abstract, with **every method async even though the static implementation is mostly synchronous**. That is deliberate: it means moving to a CMS later changes no call site. The synchronous implementations satisfy those signatures with `Promise.resolve`, never an `async` body with no `await` — `require-await` ([05](05-lint-and-format.md)) rejects the second, and it is a lie about what the method does either way.
- **`translator/message-store.ts`** — the mutable holder around an immutable snapshot, and the one object that crosses the SSR boundary and absorbs namespaces added by a client-side navigation. React-free, so `apps/worker` and Node tests use the same class the browser does.
- **Smell:** a permission key; a synchronous read method on the abstract class; **a static import of a locale catalog anywhere but `bundled.content-source.ts`**; a `MessageKey` reaching `t()` with no namespace declaration behind it; an `ERROR_COPY` value outside the shell namespaces.
- **Three items outstanding, each waiting on a caller rather than on anything here**: `SERVER_CATALOG` + `email` ([25](25-worker-app.md)), `MessageStore` ([24](24-web-app.md)), `BundledContentSource` ([30](30-desktop-app.md)). [20](20-content-package.md) marks every file and Step 20.10 lists them.

---

## 1.17 Inside `packages/query`

- **`key/`** — `QueryKeys`, mirroring procedure paths with params last. **`runtime/`** — `createQueryClient()`, the `ApiClientProvider` context, and `useAppMutation`.
- **`session/`** — session queries and mutations, the one slice that ships with the kit.
- **`<slice>/`** — per-feature `queryOptions` factories and mutations.
- **The single TanStack owner.** Exactly one package imports `@tanstack/*`, and this is it.
- **Still may not import the router package from the same vendor.** Routing stays in the app, which is what lets a desktop shell reuse everything above this layer. The gate greps for that specifier, so a comment naming it fails the gate too — paraphrase.
- **`"use client"` on line 1 of the barrel**, one of the three packages that carry it. Check it survives the build: `head -1 dist/index.js`.
- **`createQueryClient()` is a factory, not a singleton**, because a module-scope client on the server is shared across concurrent requests — a cross-tenant leak, not a caching bug.
- **Smell:** a hand-written query key at a call site.

---

## 1.18 Inside `packages/ui`

- **`theme/` and `style/`** — `theme/` is the TypeScript that chooses and scopes a theme. `style/` is every stylesheet, divided by what a file may reference. `token.css` holds the sizes — type scale, spacing, radii, elevation, motion — and **deliberately no colours**. `color/` holds one file per theme, each declaring the same twelve names under `[data-theme][data-mode]`. `base.css` and `markdown/` declare **no value of their own**: every number in them is a `var()` reaching back into the other two. A rule that breaks that direction is in the wrong file.
- **Two attributes, not one key.** `data-theme` selects the palette and `data-mode` selects light or dark, so the two axes stay independent and a palette may declare either or both.
- **`component/`** — one folder per component, `icon/`, `can/`, `data-table/`, `dialog/` and the rest, each with its `index.ts`. Components style themselves with Tailwind utilities.
- **No domain nouns.** `DataTable`, never `TaskTable`. The test is mechanical and has no judgement call in it: if the name contains a domain word, the component belongs in `feature`.
- **No router import.** Navigation arrives as an `onNavigate` prop or an `href` string.
- **`<Can>` lives here but is convenience, never the gate.** The gate is `Authorizer.assert()` in the use-case.
- **Smell:** a domain noun in an export, or a `useNavigate`.

---

## 1.19 Inside `packages/feature`

- **`i18n/`** — the message provider and hook. Lives here rather than in `content` because it is React.
- **`auth/`** — sign-in, two-factor, the session guard, and the session context. `SessionProvider` takes a `CapabilitySetDto` and reconstructs the class, so the browser runs the identical resolution the server ran.
- **`rbac/`** — the permission matrix and the effective-permissions inspector.
- **`<slice>/`** — the components that actually fetch and mutate for a feature.
- **May not import `api-client`.** Reads go through `query` so that invalidation always has something to invalidate. A direct client call in a component is a read no mutation will ever refresh.
- **May not import `@tanstack/react-router`.** Same rule as `ui`, same reason.
- **Smell:** `await client.…` inside a component, or a `<Navigate>`.

---

## 1.20 Inside `apps/web`

- **`src/env.ts`** — one of two `process.env` readers. Parses at module load, so a missing secret crashes at boot with a field path rather than 500ing an hour later. **Server-only**, and enforced by a marker import rather than by convention: everything in a TanStack Start app is isomorphic unless something says otherwise, and one client-facing accessor on `Env` is enough to put the whole schema in the browser bundle ([24](24-web-app.md) Step 24.2).
- **`src/endpoint.ts`** — `Endpoint`. The two API paths, and nothing else — what isomorphic code imports *instead of* `Env`. Reads no environment, so there is nothing for it to leak.
- **`src/server/`** — **the entire transport layer**, and the thing that moves to `apps/api` if NestJS ever arrives. Nothing above or below it changes when it does. This is why it is one directory instead of scattered through routes.
  - **`container.ts`** — one `Container` at module scope. Per-request construction would open a connection pool per request.
  - **`authed`, from `@loadbearing/api-server`** — the shared context type and the middlewares: correlation, error, principal, shard. `principalMiddleware` calls `PrincipalBuilder`, never Better Auth, fails closed on any procedure with no permission mapping, and throws `AppError`s so `errorMiddleware` logs and shapes them like everything else. It lives in a package because a second app mounts the same chain.
  - **`orpc/<subject>.router.ts`** — three lines per procedure: pull the use-case off the container, call `execute`, return.
  - **`ErrorInterceptor`, in `api-server` beside `authed`** — the one place `AppError.code` becomes a transport code, and the one place a server-side failure is logged. Reached from a **middleware**, not an adapter interceptor: oRPC's `clientInterceptors` see only the initial context, so they have no `traceId` and no request-scoped logger.
  - **`rpc-client.ts`** — the in-process client for SSR, which skips serialisation but runs the same middleware.
- **`src/route/`** — pages and composition, plus `api/rpc/$.ts` and `api/auth/$.ts`. Those two are Start server routes and are three lines each: hand the `Request` to `src/server/`, return its `Response`. Nothing here *implements* an API. Loaders reach the server through `ApiClient`, never by importing `appRouter`.
  - They are file routes rather than Nitro handlers because `serverDir` scanning is Nitro's, and Nitro is one deployment target of several — a route in the tree ships wherever the app ships ([24](24-web-app.md)).
  - **`-guard.ts`** — route gating. The leading hyphen is TanStack's marker for "not a route"; framework naming wins inside this directory.
  - **`__root.tsx`** — the composition point: both stylesheets, the pre-hydration theme script, and all four providers.
- **Smell:** a router handler longer than three lines; `createServerFn` wrapping a business operation; `import { appRouter }` in a loader; **a second directory named `server/`** — Nitro's default puts one at the app root, and taking it splits the transport layer in two.

---

## 1.21 Inside `apps/worker`

- **`src/env.ts`** — the second and last `process.env` reader. Parses a **smaller** schema than the web app's: no `AUTH_SECRET`, because the worker never issues or validates a session. Sharing one schema between the apps would hand the worker a secret it has no use for.
- **`src/main.ts`** — construct the container, start the bootstrap, register signal handlers. Graceful shutdown is not optional: killing mid-job leaves it stalled until BullMQ's lock expires.
- **`system-principal.ts`** — three named grants, checked against `PermissionRegistry` at boot. **Never a wildcard.** A wildcard here turns any bug that lets user input reach a job path into full privilege escalation.
- **`consumer/`** — one file per queue. Each is a thin adapter, exactly like an oRPC router: deserialise, build a principal, call a use-case. Handlers let errors throw, because BullMQ's retry is driven by rejection.
- **`schedule/`** — repeatable jobs, each with a fixed `jobId` so registration is idempotent across restarts. Cron never runs in the web process, because two web instances means every schedule fires twice.
- **Smell:** a `try/catch` that swallows a job failure; a wildcard principal; an HTTP server.

---

## 1.22 If a desktop shell arrives

**`apps/desktop` does not exist.** [30](30-desktop-app.md) is the plan for it, and the rules below
are what the naming above already decides, recorded so the shell is a day rather than a debate.

- **`src/config.ts`** — `Config`, reading `import.meta.env`. **Not** a `process.env` reader, because there is no Node runtime in a webview. Everything there is baked into the shipped bundle and readable by anyone who unzips the app, so it holds base URLs and flags and **never** a secret.
- **`src-tauri/src/token.rs`** — the OS keychain commands, and the only place a credential is stored. The token never touches `localStorage`, where an injected script could read it.
- **`src/token-provider.ts`** — `TauriTokenProvider`, implementing the abstract `TokenProvider` from `api-client` in two methods, `get()` and `set()`. That file plus `BearerAuthStrategy` is the *entire* difference between a desktop client and the browser client — both of which ship today, unused, which is the claim this section exists to keep honest.
- **`src/router.tsx`** — its own `@tanstack/react-router` instance on memory or hash history, because the webview serves from a custom protocol with no server to resolve a cold path against. Its own route tree; **not** its own paths — destinations come from `ROUTES` in `permissions`, and keeping the strings identical to web's is what lets a `<Link>` inside a `feature` component be correct in both shells.
- **Holds no container.** No `composition`, no `application`, no `infrastructure`, no `auth`. It is a client, and it wants the server-only ESLint boundary with no escape hatch at all — unlike `apps/web` there is no `src/server/**` to exempt. Its glob is **not** in `tooling/biome-config/src/base.json` today, and adding it is one line in an existing array rather than a new override ([05](05-lint-and-format.md)).
- **Smell:** a `process.env` reference; a secret in `config.ts`; a hand-written route path; anything imported from `composition` or `application`.

---
# Part 2 — One feature, end to end

**Task reactivation.** A closed task can be reopened, but only by someone holding `task.reactivate` on that goal, and only if the task is not locked from its assignee. Reactivating writes an audit entry and re-indexes the task for search.

Small enough to hold in your head; large enough to touch every package.

## Every file it creates

Nothing here required a decision about *where* — each path falls out of "module: `task`, action: `reactivate`, layer: X."

```
packages/permissions/src/catalog/task.permissions.ts        "task.reactivate"  (scope: goal)
packages/permissions/src/catalog/index.ts                   ← register the fragment
packages/permissions/src/gate/task.gate.ts                  module gate for the nav item

packages/contracts/src/task/task.contract.ts                TaskContract.reactivate
packages/contracts/src/task/task.entity.ts                  TaskEntity.isLockedFromAssignee()
packages/contracts/src/task/task.procedures.ts              TaskProcedures.reactivate
                                                              .route POST /tasks/{taskId}/reactivate
packages/contracts/src/contract-router.ts                   ← register
packages/contracts/src/permission/task.permissions.ts       "task.reactivate" → task.reactivate

packages/application/src/task/task.repository.ts            TaskRepository          (port)
packages/application/src/task/reactivate-task.use-case.ts   ReactivateTaskUseCase.execute()
packages/application/src/task/overdue-lock.policy.ts        OverdueLockPolicy

packages/infrastructure/src/pg/schema/task.schema.ts        tasks.reactivated_at
packages/infrastructure/src/pg/repository/pg-task.repository.ts
                                                            PgTaskRepository
packages/infrastructure/migrations/0003_task_reactivation.sql
                                                            ← + seeds the permission row

packages/query/src/task/task.mutations.ts                   TaskMutations.reactivate()
packages/query/src/task/task.queries.ts                     TaskQueries.detail(taskId)

packages/content/src/message/namespace.ts                   register "task" in NamespaceShape + ClientNamespace
packages/content/src/message/catalog.ts                     one loader per locale — total, so a missing cell will not compile
packages/content/src/message/en/task.ts                     labels, confirm copy, error text

packages/feature/src/task/reactivate-task.dialog.tsx        <ReactivateTaskDialog />

apps/web/src/server/orpc/task.router.ts                     TaskRouter.reactivate
apps/web/src/server/orpc/app.router.ts                      ← register
apps/web/src/route/(app)/_authenticated/task/$taskId.tsx     composes the dialog

packages/composition/src/consumer/embedding.consumer.ts              ← already exists, no change

packages/composition/src/container/container.ts             ← expose the use-case
```

**The migration is what makes the feature appear.** Until it seeds `task.reactivate` and grants it to the right roles, the button is invisible and the endpoint returns `FORBIDDEN` for everyone. That is the staged-rollout mechanism working as designed.

## Flow 1 — rendering the page

```
Browser requests /task/abc123
        │
        ▼
apps/web  route/(app)/_authenticated/task/$taskId.tsx
        │  beforeLoad → RouteGuard.requireSession(), in (app)/_authenticated.tsx above
        │  loader     → ApiClient (in-process on SSR, HTTP in the browser)
        ▼
packages/api-server  router/base.ts
        │  principalMiddleware
        │    → auth  PrincipalBuilder.fromHeaders()
        │        → auth  BetterAuthSessionResolver     (who is this?)
        │        → auth  CapabilityCache               (Redis, 60s backstop)
        │            └ miss → infrastructure  PgCapabilityRepository  (3 queries)
        │    → contracts  ProcedurePermissions.required("task.get")
        ▼  Principal { userId, CapabilitySet }
apps/web  server/orpc/task.router.ts        ← three lines
        ▼
application  GetTaskUseCase.execute(principal, input)
        │  1. load     → TaskRepository (port)  ──► infrastructure  PgTaskRepository
        │  2. authorize → Authorizer.assert(principal, "task.read", goalId)
        │  3. work     → TaskEntity
        ▼  TaskDto
        ▼
Back through the router. SSR serialises the DTO, the CapabilitySetDto **and** the
MessageSnapshot into the HTML payload — so the first paint already knows what to
hide, and says it in the right language. Three things, one mechanism.
        ▼
feature  <TaskDetail> → ui  <Can permission="task.reactivate" goalId={…}>
                              ui  <Button> "Reactivate"
```

**Note what the loader did not do**: it did not import `appRouter`, and it did not make an HTTP call to its own server. `ApiClient.inProcess` skips serialisation but runs the *same* middleware and the *same* `Authorizer.assert()`.

## Flow 2 — the mutation

```
User clicks Reactivate
        ▼
feature  <ReactivateTaskDialog>
        │  reads copy from content  message/en/task.ts
        │  (inlined by the route's loader — never fetched)
        ▼
query  TaskMutations.reactivate()          ← useAppMutation, declares its invalidations
        ▼
api-client  ApiClient.task.reactivate({ taskId, reason })
        │  auth/  CookieAuthStrategy   (web)  ─┐
        │         BearerAuthStrategy   (desktop) ┘  same call site
        ▼  POST /api/rpc  →  /tasks/{taskId}/reactivate
apps/web  route/api/rpc/$.ts
        ▼  principalMiddleware  (identical to Flow 1)
apps/web  server/orpc/task.router.ts
        ▼
application  ReactivateTaskUseCase.execute(principal, input)
        │
        │  1. LOAD       TaskRepository.findByIdOrFail(taskId)
        │  2. AUTHORIZE  Authorizer.assert(principal, "task.reactivate", task.goalId)
        │                  └ fails → ForbiddenError        ◄── THE gate
        │  3. WORK       OverdueLockPolicy + TaskEntity.reactivate(clock.now())
        │                  └ fails → ConflictError
        │  4. PERSIST    UnitOfWork
        │                  ├ TaskRepository.save(task)      → infrastructure
        │                  └ ActivityLogger.log("task.reactivated")  → infrastructure
        │  5. ENQUEUE    QueuePublisher.publish("embedding.generate", …)
        │                  → infrastructure  BullMqQueuePublisher → Redis
        ▼  TaskDto
apps/web  server/orpc/error.interceptor.ts
        │  DomainError.code → ORPCError     (ForbiddenError → FORBIDDEN)
        ▼
query  invalidates ["task","detail",id] and ["task","list"] — declared, not remembered
        ▼
UI re-renders
```

Then, independently:

```
Redis  embedding.generate
        ▼
apps/worker  consumer/embedding.consumer.ts
        │  SystemPrincipal.forOrganization(orgId)   ← three named grants, never a wildcard
        ▼
application  IndexTaskUseCase.execute(systemPrincipal, …)
        │  → EmbeddingProvider (port) → infrastructure  OpenAi… or GeminiEmbeddingProvider
        │  → VectorStore       (port) → infrastructure  PgVectorStore
        ▼  row in task_embeddings
```

**The worker never touched `principalMiddleware`** — which is precisely why `Authorizer.assert()` inside the use-case is the real gate and the middleware is defence in depth.

## Flow 3 — one decision, four surfaces

An admin removes `task.reactivate` from the Manager role. Nobody deploys anything.

```
postgres  role_permissions row deleted
        ▼
auth  CapabilityCache invalidated for every affected user
        ▼
        ├── ui       <Can>              → button disappears
        ├── apps/web RouteGuard         → /task/…/reactivate redirects to /forbidden
        ├── content  nav (module gate)  → menu entry disappears
        └── application Authorizer      → API returns FORBIDDEN
```

**Four surfaces, one `CapabilitySet.can()`, zero frontend changes.** The first three are convenience. The fourth is security. That ranking is the reason `permissions` has no database access and no async methods — it is the one artifact all four surfaces can share.

## What the example demonstrates

**Every filename was derivable.** Not one required looking up a precedent — module plus action plus layer produced all twenty-three paths.

**The domain layer imported no framework.** `ReactivateTaskUseCase` names `TaskRepository`, `UnitOfWork`, `ActivityLogger`, and `QueuePublisher` — all abstract. It can be tested with four fakes and a `FixedClock`, and it would run unchanged under NestJS.

**Every use-case followed load → authorize → work → persist.** Authorization is step two, in the use-case, every time. Never in middleware, never in a router, never only in the UI.

**Swapping anything is local.** Postgres → another SQL database: `infrastructure/src/pg/` only. pgvector → Qdrant: one line in `container/container.ts` plus a new store class. TanStack Start → NestJS: `apps/web/src/server/` moves and the error interceptor becomes an exception filter. Web → desktop: one `AuthStrategy` swap ([30](30-desktop-app.md)).

---

## ✅ Gate

Given a feature name and a layer, you can write the file path and the class name without looking anything up — and for any file in the tree, you can say what it must not contain.

---

[← Folder Structure](28-folder-structure.md) · [A desktop shell, if one arrives →](30-desktop-app.md)
