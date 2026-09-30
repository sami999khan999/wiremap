---
title: Porting
description: The general procedure for bringing a piece of the big kit back into the lite kit — getting the source, the copy order, migrations, wiring, and the checks that prove it worked.
---

# Porting a piece back from the big kit

Every page in this folder follows this procedure. The page names *what* to copy; this page says
*how*.

## 1. Get the big kit at the right commit

```bash
git clone https://github.com/prodicle/loadbearing_tanstack_start_kit.git ../loadbearing-upstream
git -C ../loadbearing-upstream checkout 3fafa78c2f42d2d718236d7666429b858199118a
```

Keep it beside this repository, read-only. **Port from this commit only.** If the big kit has since
fixed a bug in the piece you are porting, port the piece first, commit, then apply that fix as its
own change — never both at once.

## 2. Copy in slice order

Copy files in the order [`docs/ai/skills/add-slice.md`](../ai/skills/add-slice.md) gives, one layer
at a time, so each step compiles against the one before:

1. `permissions` — catalog keys, routes, gates
2. `contracts` — contracts, entities, procedures, the catalog map, the merged procedure barrel
3. `infrastructure` — the schema file, repositories and adapters
4. `application` — ports, rules, use-cases
5. `composition` — the wiring in `container.ts`, plus the in-memory fakes in `fake/`
6. `api-client`, `query`, `content` (en **and** bn), `feature`
7. `apps/*` — routers, routes, worker consumers and schedules

The package, file and class names are identical in both kits, so **a copied file needs no import
edits**. If one does, something was renamed in lite — stop and find out why before continuing.

Every barrel (`index.ts`) names its exports explicitly; add the ported ones to each barrel you copy
into. `export *` is banned.

## 3. Migrations: regenerate, never replay

Lite does **not** carry the big kit's migration history. It starts from one squashed baseline, so
the big kit's numbered migrations cannot be applied as they are.

1. Copy the feature's **schema file** into `packages/infrastructure/src/pg/schema/` and register it
   in that folder's barrel.
2. Run `pnpm db:generate`. It runs drizzle-kit and then writes the `PARTITION BY` clauses, and it
   produces a new, correctly numbered migration from the schema's *final* shape.
3. **Hand-port what drizzle cannot generate** from the big kit's migrations that the page lists:
   permission rows and grants to system roles, triggers, role defaults, data backfills. Append them
   to the generated migration.
4. Do not replay a chain of big-kit migrations (create, alter, drop). The final schema file already
   is their result.

## 4. Env, compose, container

- **Env:** add each new variable to every `apps/*/src/env.ts` that needs it and to `.env.example`,
  with the big kit's comment. The CI check compares the two.
- **Compose:** copy the service definition from `upstream:infra/docker-compose.yml`, keeping its
  profile. Lite's host ports start with `2` where the big kit's start with `1`.
- **Container:** the big kit's `upstream:packages/composition/src/container/container.ts` shows where
  the adapter is constructed and which use-cases receive it. Wire the same way. **The composition
  root is the only place an adapter's concrete class may be named.**

## 5. Prove it

```bash
pnpm build:packages && pnpm typecheck && pnpm lint && pnpm test
pnpm check:architecture
pnpm db:migrate && pnpm db:seed
node tooling/scripts/boot-smoke.mjs
```

Copy the piece's specs from the big kit's `tests/` folders along with its code — they are the proof
the port works, and they already exist.

## 6. Record it

- Add a row to [`UPSTREAM.md`](../../UPSTREAM.md): what was ported, from which commit, on which date.
- Mark the page in this folder as ported (a `> [!NOTE]` at its top).
- Commit one layer at a time, with a conventional-commit scope.
