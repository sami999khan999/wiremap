# Starter Kit — Build Order

> The reusable foundation every project on this architecture starts from. Postgres + Drizzle, one Redis instance under two names, S3, Better Auth, pgvector behind a swappable seam, and the fifteen-package layout from the architecture docs — with **no product features in it**.

**Stack:** pnpm workspaces (no Turborepo) · TanStack Start + oRPC · standalone worker · Postgres 17 + pgvector · Redis (cache + queue, one instance) · S3 (MinIO locally) · Better Auth · logs to stdout
**Paradigm:** strictly object-oriented everywhere except React components and hooks.

---

## How to use these documents

Work through them **in order**. Each one ends with a **✅ Gate** — a concrete, checkable condition. The order is a real dependency chain: `core → permissions → contracts → asset → content → application → infrastructure → auth → composition → api-client → query → ui → feature → apps`. pnpm derives build ordering from the workspace graph, so nothing declares it.

Nothing here creates a feature. When you finish [27](27-verification-and-first-feature.md) you have a repo that boots, authenticates, stores files, caches, embeds, enforces permissions, records an audit trail inside the transaction, and is tenant-scoped from the first migration — and contains zero business logic. Feature 01 is then the first thing you write on top.

**Where each fact lives is decided before you start.** [Data and scale](../opinions/data-and-scale.md) settles which store owns which stream, what is derived, and what has to exist from day one — `organization_id`, partitioning, the two Redis URLs. Several steps below exist in the shape they do because of it; read it once before [11](11-local-infrastructure.md).

| Symbol | Meaning |
|---|---|
| **Create file X** | Make it in your editor and paste the contents. No shell heredocs, so nothing is OS-specific. |
| Fenced `bash` block | A command. `pnpm`, `git`, `docker`, and `node` behave identically on Windows, macOS, and Linux. |
| **✅ Gate** | Do not proceed until this passes. |

---

## The sequence

### Phase A — the repo exists

| # | File | Delivers |
|---|---|---|
| 01 | [Prerequisites](01-prerequisites.md) | Node 24, pnpm 11, Docker, Git configured for a mixed-OS team |
| 02 | [Repository Skeleton](02-repo-skeleton.md) | Four top-level folders, six root files, first commit |
| 03 | [Workspace & Catalogs](03-workspace-and-catalogs.md) | `pnpm install` succeeds; topological scripts replace Turborepo |
| 04 | [TypeScript Configs](04-typescript-configs.md) | Four shared `tsconfig` bases |
| 05 | [Lint & Format](05-lint-and-format.md) | Biome, and the six ESLint rules that mechanically enforce OOP + the server-only boundary |
| 06 | [Package Anatomy](06-package-anatomy.md) | The shape every package copies, and the one-shot scaffold script |

### Phase B — the shared kernel

| # | File | Delivers |
|---|---|---|
| 07 | [`@loadbearing/core`](07-core-package.md) | `Result`, `Clock`, `Uuid`, `ServerOnly` — its one dependency is `errors`, built first |
| 08 | [`@loadbearing/permissions`](08-permissions-package.md) | `PermissionRegistry`, `ModuleRegistry`, `CapabilitySet` |
| 09 | [`@loadbearing/errors`](09-errors-package.md) | `AppError`, the closed `ErrorCode` union, the wire envelope, `ErrorNormalizer` — plus the error slice of [20](20-content-package.md), because a code with no copy is a raw `SERVER_ONLY` on a customer's screen |
| 09b | [`@loadbearing/observability`](09b-observability-package.md) | `JsonLogger`, the closed event catalog, `EventShape`, `Redactor`, `Correlation` — lettered because [12](12-application-package.md) bans importing it and must come after |
| 10 | [`@loadbearing/contracts`](10-contracts-package.md) | Zod contract classes, entities, oRPC contract router, `ProcedurePermissions` |

### Phase C — the server side

| # | File | Delivers |
|---|---|---|
| 11 | [Local Infrastructure](11-local-infrastructure.md) | Postgres + pgvector, **one** Redis instance with two URLs, MinIO and its buckets, and Mailpit |
| 12 | [`@loadbearing/application`](12-application-package.md) | `Principal`, `Authorizer`, **all sixteen ports** — zero framework imports |
| 13 | [`@loadbearing/infrastructure` — Postgres](13-infrastructure-postgres.md) | Drizzle, tenant-scoped repositories, partitioned migrations, seeds |
| 14 | [Vector Storage](14-vector-store.md) | `VectorStore` port + `PgVectorStore`, sized so Qdrant is a one-line swap |
| 15 | [`@loadbearing/infrastructure` — the rest](15-infrastructure-package.md) | Redis cache **and** queue connections, S3 storage gateway, BullMQ queue publisher, SMTP sender |
| 16 | [`@loadbearing/auth`](16-auth-package.md) | Better Auth, `PrincipalBuilder`, capability cache, API keys |
| 17 | [`@loadbearing/composition`](17-composition-container.md) | The `Container` DI root |

### Phase D — the client side

| # | File | Delivers |
|---|---|---|
| 18 | [`@loadbearing/api-client`](18-api-client-package.md) | oRPC client + `AuthStrategy` — React-free |
| 19 | [`@loadbearing/asset`](19-asset-package.md) | Every binary: images, icon sprite, fonts |
| 20 | [`@loadbearing/content`](20-content-package.md) | Messages, documents, collections, `ContentSource`, **all error copy** |
| 21 | [`@loadbearing/query`](21-query-package.md) | The single TanStack owner: keys, options, client factory |
| 22 | [`@loadbearing/ui`](22-ui-package.md) | Design system with no domain nouns |
| 23 | [`@loadbearing/feature`](23-feature-package.md) | Components that fetch and mutate |

### Phase E — the apps and the seal

| # | File | Delivers |
|---|---|---|
| 24 | [`apps/web`](24-web-app.md) | TanStack Start, oRPC handler, auth handler, route + UI gating |
| 25 | [`apps/worker`](25-worker-app.md) | BullMQ consumers and repeatable schedules |
| 26 | [Hygiene & CI](26-hygiene-and-ci.md) | Hooks, commit scopes, pipeline, bundle-leak assertion |
| 27 | [Verification & First Feature](27-verification-and-first-feature.md) | Architecture checks, commit sequence, the add-a-module checklist |
| 30 | [`apps/desktop`](30-desktop-app.md) | **A plan, not a build.** Tauri: what one app directory and zero new packages would take |

> 30 is numbered last because it is read last — it depends on every package above it. It is not optional: Tauri is the desktop shell, and 16, 24 and 28 are written on that basis.

### Reference

| # | File | Delivers |
|---|---|---|
| 28 | [Folder Structure](28-folder-structure.md) | The complete tree after step 27, on one page |
| 29 | [Boundaries](29-naming-and-boundaries.md) | What each folder does and doesn't do, one feature traced end to end |

### Opinions

Not part of the build order. [`docs/opinions/`](../opinions/index.md) is the reference consulted
continually — every rule for what to call a thing and where to put it, one page per topic.

| Page | Decides |
|---|---|
| [Files](../opinions/files.md) | Casing, role suffixes, one class per file, where tests go |
| [Folders](../opinions/folders.md) | What `src/` looks like, role folders vs subject folders |
| [Imports and exports](../opinions/imports.md) | `index.ts`, `import.ts`, the three import rules |
| [Dependencies](../opinions/dependencies.md) | The tiers, which layer may name a framework, what the catalog enforces |
| [Classes and methods](../opinions/classes.md) | Class-name grammar, banned suffixes, method vocabulary |
| [Vocabulary](../opinions/vocabulary.md) | Permissions, procedures, events, queues, contracts, database |
| [Data and scale](../opinions/data-and-scale.md) | Which store owns which data, what is derived, what to build now |
| [Simplicity](../opinions/simplicity.md) | How much structure to build; performance is part of the goal |
| [Comments](../opinions/comments.md) | Line comments only, two lines, where the reasoning goes |

---

## The fifteen packages, in one paragraph

`core` holds primitives. `observability` holds the diagnostic stream — closed event codes, levels decided by a catalog, structured JSON to stdout, lossy by design — kept strictly apart from the audit trail, and nothing in `application` may reach it. `permissions` decides who may do what. `errors` defines how a failure is shaped, serialised, and named — every runtime throws and reconstructs the same class, and it carries no prose, because `content` owns every word a user reads. `contracts` defines what data looks like and what it knows about itself. `application` holds every operation the product can perform plus the abstract ports it needs, with no framework anywhere. `infrastructure` implements every one of those ports against a real system: Postgres in `src/pg/`, S3, the queue, the mail transport, the embedding providers, and both Redis connections — one instance in lite, under `noeviction`, because the queue must not lose a job. `auth` owns identity and turns any credential into a `Principal`. `composition` wires all of it together. `asset` holds every binary the product ships. `content` holds every user-visible string. `api-client` reaches the server, `query` caches what comes back, `ui` renders it, and `feature` assembles those into screens. The apps are thin adapters that read configuration, mount a transport, and compose components.

---

## Three deliberate departures from the architecture docs

All three are called out again where they happen. Read them now so they aren't a surprise.

**1. `packages/infrastructure` holds every adapter, Postgres included.** An earlier draft split them — a `db` package for Postgres, `infrastructure` for the rest — and the split put one seam in two places: `PgVectorStore` on one side, and every remote-store adapter on the other. They were folded together in this direction rather than the other because the name has to stay honest: an S3 client in a package called `db` would be a lie, but Postgres genuinely is infrastructure. The package is organised by vendor — `pg/`, `redis/`, `s3/`, `bullmq/`, `openai/`, `gemini/`, `unified/`, `smtp/` — so `rm -r src/gemini/` is the complete answer to a swap.

**2. `VectorStore` is declared in `application/port/`, not beside its implementation.** The architecture docs put the abstract class in the database package. That works only while the implementation is Postgres. Your requirement is to move to a dedicated vector database later without rewrites, and a use-case cannot depend on an adapter package — so the abstraction has to sit where every other port sits. `PgVectorStore` still lives in `packages/infrastructure/src/pg/repository/`. See [14](14-vector-store.md).

**3. There is no analytics store, and no seam for one.** The big kit kept `AnalyticsProjector`, the half of the analytics port with a consumer, and deleted `AnalyticsReader`, the half nothing called. Lite removes both, with ClickHouse. A cross-tenant aggregate waits for that store rather than being written against Postgres. [Analytics](../scale/analytics.md) brings it back; [Data and scale](../opinions/data-and-scale.md) §4.3 has the argument.

---

## If you only remember seven things

1. **Everything that matters lives in `packages/`.** `apps/` holds framework code and nothing else.
2. **Authorization lives in the use-case**, not in transport middleware. Middleware is bypassed by the worker and by SSR direct calls; `Authorizer.assert()` isn't.
3. **Domain errors, never HTTP errors, in `@loadbearing/application`.** `ForbiddenError` maps to `ORPCError('FORBIDDEN')` at the adapter.
4. **No package reads `process.env`.** Config is read once in an app and handed down as constructor arguments.
5. **Exactly one package imports `@tanstack/*`** — `query`. `api-client` stays React-free; `feature` may not import `api-client`.
6. **Server-only packages have three defences** — the Biome import boundary, the `ServerOnly.assert()` tripwire, and the CI bundle check.
7. **Postgres owns anything a transaction depends on or a user reads immediately after writing.** Everything else is a derived store behind a port — and never write a query that cannot be scoped to a tenant. See [Data and scale](../opinions/data-and-scale.md).

---

## Renaming the scope

Every package is `@loadbearing/*` so these documents line up with the architecture docs you already have. To rebrand the kit for a new project, change:

- the `name` field in each `packages/*/package.json` and `apps/*/package.json`
- the `@loadbearing/` prefix in every import (one editor-wide find and replace)
- `noExternal: [/^@loadbearing\//]` in `apps/web/vite.config.ts`
- the `@loadbearing/*` entries in `noRestrictedImports` in `tooling/eslint-config/src/index.js` and in `tooling/biome-config/src/base.json`
- `name: ratchet` and the credentials in `infra/docker-compose.yml`

**Then the two defaults that are baked into shipped code rather than into local config**, none of
which a find-and-replace on `@loadbearing/` will reach:

- `advanced.cookiePrefix` in `packages/auth/src/factory/auth.factory.ts` — user-visible in the browser, and
  changing it later invalidates every cookie already issued
- the `keyPrefix` default in `packages/infrastructure/src/redis/redis.connection.ts` — a stale one is
  a cache that reads nothing, with no error anywhere

Both ship generic on purpose. If you replace them with your own name, they belong on this list
for whoever renames next.

Nothing else. Do it before the first commit, not after.

---

[Prerequisites →](01-prerequisites.md)
