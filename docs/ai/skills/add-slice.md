---
title: Adding a feature slice
description: The twelve-step path a feature takes through the packages, as an executable checklist. Setup 27.4 is the reasoning; this is the run book.
---

# Adding a feature slice

A slice is one vertical: `<subject>` = `lead`, `invoice`, `task`, whatever you are building. It
touches twelve places in a fixed order.

**The order is not arbitrary — each step compiles against the one before it.** Write the permission
first and the contract third, and by the time you reach the React component the permission key
autocompletes and a typo in it is a compile error. If a feature needs a step outside this list,
logic has landed in the wrong layer. Stop and look again.

[27 · Verification and your first feature](../../setup/27-verification-and-first-feature.md) §27.4 states
the same twelve steps and explains *why* each one sits where it does. This page is the run book:
what to write, what to check, what to commit.

---

## Before you start

1. Read [Folders](../../opinions/folders.md) and [Files](../../opinions/files.md). They decide every path and
   filename below; do not infer conventions from surrounding code.
2. Read the `role` slice end to end. It walks all twelve steps, reuses an existing permission rather
   than adding one, and lands at `/settings/roles` behind a `RouteGuard`:

   | Layer | File |
   |---|---|
   | contract | `packages/contracts/src/role/{index,role.contract,role.entity,role.procedures}.ts` |
   | procedure permissions | `packages/contracts/src/catalog/role.permissions.ts` |
   | port + use-case | `packages/application/src/rbac/{role.repository,list-roles.use-case}.ts` |
   | tables | `packages/infrastructure/src/pg/schema/rbac.schema.ts` |
   | adapter | `packages/infrastructure/src/pg/repository/pg-role.repository.ts` |
   | queries | `packages/query/src/rbac/role.queries.ts` |
   | copy | `packages/content/src/message/{en,bn}/role.ts` |
   | components | `packages/feature/src/rbac/` |
   | router | `apps/web/src/server/orpc/role.router.ts` |
   | route | `apps/web/src/route/(app)/_authenticated/settings/roles.tsx` |

3. Decide the subject noun. It is singular, kebab-case in paths, and the **same word in every
   package** — `contracts/src/lead/`, `application/src/lead/`, `query/src/lead/`,
   `feature/src/lead/`, `web/src/route/(app)/_authenticated/lead/`. One glob per team:
   `packages/*/src/lead/**`.

---

## The twelve steps

### 1 — Permissions (`packages/permissions`)

```
src/catalog/<subject>.permissions.ts     the lead.* keys
src/catalog/index.ts                     register the fragment
src/route/<subject>.routes.ts            the slice's destinations
src/route/index.ts                       register the fragment
src/gate/<subject>.gate.ts               nav gate, only if it gets a menu entry
src/gate/index.ts                        register the fragment
```

Often empty — reuse an existing key when the slice fits an existing module, as `role` reuses
`rbac.role.read`.

**Scope is `org` unless the slice is platform-wide, and then it is `platform`.** A `platform`-scoped
key is held only through a role in the organization marked `is_platform`: it never reaches a tenant
role, `owner: "all"` excludes it at seed time, and the tenant role editor does not offer it. Pick it
for a setting that is one number for the whole deployment, never for one a tenant owns. See
[platform-scope](../../../packages/permissions/docs/reference/platform-scope.md).

### 2 — Error codes (`packages/errors`) — usually empty

Only if a caller would genuinely **branch** on the failure differently. Most slices fail the ways
every slice fails (forbidden, not found, conflict) and reuse the shared codes.

A new code cannot ship without copy: `packages/content/src/message/error-copy.ts` is a
`Record<ErrorCode, ShellMessageKey>` and will not compile until the sentence exists.

### 3–5 — Contracts (`packages/contracts`)

```
src/<subject>/index.ts
src/<subject>/<subject>.contract.ts       -> <Subject>Contract     (zod shapes)
src/<subject>/<subject>.entity.ts         -> <Subject>Entity
src/<subject>/<subject>.procedures.ts     -> <Subject>Procedures
src/procedure/index.ts                    register the procedures on the merged contract
src/catalog/<subject>.permissions.ts      every procedure path -> its permission key
src/catalog/index.ts                      register the fragment
```

Contract members use the same static names in every `*Contract`: `entity`, `create`, `update`,
`listQuery`, `<verb>`. Derived types are `Dto` for wire shapes and `Input` for procedure inputs,
never both on one type.

A unit test fails if any procedure lacks a `ProcedurePermissions` entry, and `principalMiddleware`
denies it at runtime if that test is skipped.

### 6 — Persistence (`packages/infrastructure`)

```
src/pg/schema/<subject>.schema.ts              tables
src/pg/schema/index.ts                         register — drizzle-kit sees only what this barrel names
src/pg/repository/pg-<subject>.repository.ts   -> Pg<Subject>Repository
```

Non-negotiable in the schema:

- `organization_id` on **every** table, as a branded `OrganizationId`. It is the sharding key and
  the boundary every query narrows by. `check-architecture.mjs` §9 enforces the column.
- **Every unique index leads with the tenant column.** `roles_key_uq` on `(key)` alone means two
  tenants cannot both have an `owner` role.
- An index on every foreign key and every filtered column — Postgres does not auto-index FKs.
- Append-only table? **Partition it in this migration.** Converting a large table later is a rewrite
  with downtime. A partitioned table's primary key must include the partition key, and Drizzle
  cannot express `PARTITION BY` — hand-edit the generated DDL.
- Table names are `snake_case` plural; append-only tables are singular (`activity_log`). Zod enums
  mirror the DB enum values exactly — `in_progress`, never `IN_PROGRESS`.

The adapter implements the port from step 7 and is scoped by tenant in every method.

> `infrastructure` is the documented exception to subject folders — a slice splits across
> `pg/schema/` and `pg/repository/` because `drizzle.config.ts` needs one barrel naming every table.

Then `pnpm db:generate`, and review the SQL before `pnpm db:migrate`.

### 7 — Domain (`packages/application`)

```
src/<subject>/index.ts
src/<subject>/<subject>.repository.ts         -> <Subject>Repository   (abstract port)
src/<subject>/<verb>-<subject>.use-case.ts    -> <Verb><Subject>UseCase
```

- Use-case entry method is always `execute(principal, input)`.
- Repository reads: `findBy<X>` (nullable) / `findBy<X>OrFail` (throws); writes: `save`, `delete` —
  never `update`/`insert`; existence: `exists<X>`.
- **No framework import. No logging.** Both are CI assertions.
- The repository port lives **in the slice**, not in `src/port/`. `port/` is for cross-cutting seams
  the whole system shares — the test is whether a second feature adds a *method* to it (`port/`) or
  a *file beside it* (the slice).
- Authorize with `authorizer.assert(...)`, never `can(...)`. `can()` answers a question; `assert()`
  enforces an outcome. Mixing them is how a UI check silently becomes the only check.
- **Never write a query that cannot be scoped to a tenant.** A cross-tenant aggregate belongs in the
  analytics store, read through a port of its own rather than from a use-case.
- **Declare the action before you record it.** `ActivityLogger.record` takes `ActivityAction`, the
  key union over `ACTIVITY_ACTIONS`, so a new audit action is a line in
  `packages/contracts/src/catalog/<slice>.actions.ts` first — past tense, with a label for the
  projection screen — and the call site compiles second. One call site emitting two actions
  (deactivate / reactivate) declares both.

### 8 — Client data (`packages/api-client`, `packages/query`)

```
packages/api-client/src/client/api-client.ts          one `get <subject>()` accessor, if not generic
packages/query/src/<subject>/index.ts
packages/query/src/<subject>/<subject>.queries.ts     -> <Subject>Queries
packages/query/src/<subject>/<subject>.mutations.ts   -> <Subject>Mutations
packages/query/src/key/query-key.ts                   the slice's keys, mirroring its procedure paths
```

Query keys mirror the procedure path with params last — `["task", "list", { goalId }]` — and are
never hand-written at a call site.

### 9 — Copy (`packages/content`)

Three edits, in this order:

```
src/message/namespace.ts        register "<subject>" in NamespaceShape + ClientNamespace
src/message/catalog.ts          one loader per locale — total, so a missing cell will not compile
src/message/en/<subject>.ts     labels, empty states, validation copy   (+ any other locale added later)
```

The namespace must be registered **before** the component that calls `useMessages("<subject>")` —
that hook's key type is derived from `NamespaceShape`, so writing the component first means the
argument itself will not typecheck.

### 10 — Components (`packages/feature`)

```
src/<subject>/index.ts
src/<subject>/<component-name>.tsx
```

`feature` may not import routing. Pass navigation in as an `onNavigate` prop or an `href` string.

### 11 — Transport (`apps/web`)

```
src/server/orpc/<subject>.router.ts    three lines per procedure
src/server/orpc/app.router.ts          mount it — the shape mirrors `contract`
```

### 12 — Route + wiring

```
apps/web/src/route/(app)/_authenticated/<subject>/    compose the components
packages/composition/src/container/container.ts  expose the new use-cases
```

The route needs `staticData.messages` and its loader's `ensure(["<subject>"])` — see
[24 · Web app](../../setup/24-web-app.md) §24.10. A route that forgets them renders raw keys rather than
throwing, which is what makes the omission visible in review instead of at 3am.

**Under `(app)/_authenticated/` the session check is already done** — the pathless layout runs
`RouteGuard.requireSession()` for the whole subtree, so the page states only the capability it
needs. **And its URL is whatever step 1 declared in `ROUTES.<subject>`**, spelled again as the
`createFileRoute()` literal; the nav gate reads the same entry, so a page mounted somewhere else is
a gate pointing at a 404. A page that needs no session goes in `(shell)/` instead; a design or QA
surface goes in `(dev)/`.

### Plus: the permission migration

**A migration seeding the new permission rows and granting them to the right system roles.** Until
it runs, the feature is invisible and uncallable for everyone. That is the staged-rollout mechanism
working, not a bug.

---

## Verify

```bash
pnpm build:packages
pnpm --filter @loadbearing/web build
pnpm check:architecture      # a "○ skipped" line is unverified, not passed
pnpm typecheck && pnpm lint && pnpm test
```

Then check by hand, because a green build does not give you these:

- Removing the permission from a role removes the nav item **and** returns `FORBIDDEN` from the API,
  with no frontend change.
- `grep -rn "Pg<Subject>Repository" packages/ apps/` hits exactly two packages: `infrastructure`
  (defined, named by its barrels) and `composition` (`src/import.ts` and
  `src/container/container.ts`). A third hit means a use-case named a concrete adapter and the swap
  is no longer cheap.
- No repository method queries without narrowing by `organization_id`.
- Integration tests assert a **fixed query count** for any method that loops. An N+1 is invisible at
  fifty rows and fatal at fifty thousand.

---

## Commit

Conventional commits, one per layer, using the closed `scope-enum` in `commitlint.config.js`:

```
feat(permissions): <subject> keys, routes, gate
feat(contracts): <subject> contract, entity, procedures, procedure permissions
feat(infrastructure): <subject> schema, migration, repository
feat(application): <subject> port and use-cases
feat(query): <subject> queries and keys
feat(content): <subject> namespace and copy
feat(feature): <subject> components
feat(web): <subject> router and route
```

A rejected scope means you added a package and forgot to update the enum.
