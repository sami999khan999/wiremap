---
title: Handoff
description: Where the lite kit's build stopped, what is verified, and exactly how to pick it up on any machine or in a fresh session.
---

# Handoff

**Stopped 2026-09-30, partway through Phase 1 of [`LITE-KIT-PLAN.md`](LITE-KIT-PLAN.md).** Read this
page first, then the plan. The plan holds every decision and every open item; this page holds the
state of the tree and the traps that cost time.

## Where it stands

| Commit | What |
|---|---|
| `43bc2a6` | Phase 0: the big kit at `3fafa78c`, renamed, ports on `2xxxx`, docs adapted |
| `7f88b41` | `LT1.1`: messaging removed from every layer |
| `3af3b00` | `LT1.2`: widgets and zones removed from every layer; the dashboard is static |
| `4873640` | `LT1.3`: the analytics, retention, shards and storage platform pages removed |
| `7100f81` | `LT1.4`: ClickHouse analytics removed, the tenant Activity page with it |
| `ce72bdc` | `LT1.5`: verified, no code change |
| `ad78a30` | `LT2.1`: the tenant-move machinery removed, the shard seam kept |
| `a6f3d27` | `LT2.2`: verified, no code change |
| `9ee1ccd` | `LT2.3`: calendar retention and the cold tier removed, the delete archive kept |
| `aa41dba` | `LT2.4`: Loki, Alloy and the log reader removed |
| `d7ba5b3` | `LT2.5`: compose down to five containers, one Redis, no pooler |
| `a3973f7` | `LT2.6`: verified, no code change; `TESTS.md` added |
| `0e82b69` | `LT2.7`: verified, no code change |
| `0f3cc37` | `LT2.8`: the migrations squashed into `0000_lite_baseline.sql`; `check-architecture` 30 of 30 |
| `6dad856` | `LT3`: the `owner` doc audience |
| `b77ec46` | `LT4`: search without OpenAI — `none`, `openai` or `gemini` |
| after `b77ec46` | `LT5`: CI on one Redis, the README, `docs/infra` trimmed, the check-architecture change log |

**Done:** Phase 0 (`LT0.1`–`LT0.5`), `LT0.3`, `LT5.4`, `LT1.1`, `LT1.2`, `LT1.3`, `LT1.4`, `LT1.5`, `LT2.1`, `LT2.2`, `LT2.3`, `LT2.4`, `LT2.5`, `LT2.6`, `LT2.7`, `LT2.8`, Phases 3, 4 and 5, and the `docs/plans/` exemption from `LT5.1`.

**Next, in order:** `LT1.6` the docs sweep, the only item left; then the owed runs in [`TESTS.md`](TESTS.md) and a first push.

**The remote is `origin`** (GitHub). `main` matched it at `25cd0b0`; nothing after that is pushed.

## What is verified after `LT2.5`

Checked on Linux (Node 24, pnpm 11, Docker 29) against a fresh `infra:up`, `db:migrate` and `db:seed`.

- Typecheck clean in every package; `pnpm lint` clean apart from one warning that was already
  there (an unused import in `feature/src/rbac/effective-permissions.inspector.tsx`).
  `check:contrast`, `deps:check` and `repo:check` green.
- Tests, per package: application 305, infrastructure 307, query 64,
  web 65, worker 40, permissions 69, contracts 58, composition 66, feature 161, auth 71, ui 103,
  tooling 140, and every other package green. The drop since `7f88b41` is the widget, zone and
  dashboard specs, then the specs of the four platform pages' use-cases and the shard-map panel,
  then the analytics consumer, ClickHouse, replay-reader and activity-trend specs, then the
  relocate and reclaim specs, then the retention, restore and cold-reader specs.
- `pnpm smoke` 25 passed, 1 skipped; `boot-smoke.mjs` boots worker, web and realtime.
- `check:architecture`: 29 of 30. §30 left with widgets and §31 kept its number. **The red one is
  expected** — "every partitioned table is on the allowlist" reads migrations `0023` (the three
  messaging tables) and `0047` (`widget_preferences`). `LT2.8` regenerates the baseline and clears
  it. Do not add an exemption.

### Known failures that are not defects

1. `tooling/scripts` ends with `Timeout calling "onTaskUpdate"` although every test passes. The big
   kit does the same at the cut commit. `BACKLOG.md` `BL.1`. It did not appear on the Linux run.

## Decisions taken since the plan was written

- **From `LT2.6` on, the build runs typecheck and `check:architecture` only** (owner's call,
  2026-10-01). Every test run owed goes in [`TESTS.md`](TESTS.md), for the owner to run in one pass.
- **Keep the seams** (plan decision 5): tables stay partitioned, shard placement stays, one node.
- **Flags stay server-side only** (decided 2026-09-30, recorded under `LT1.2`). The only declared
  flag, `widget.dismissal`, leaves with widgets, so `FLAGS` is empty and no flag reaches the
  browser until widgets are ported back. `flags.assertOn` still gates a procedure with `NOT_FOUND`.
- **Docs are swept once**, after Phases 1 and 2, not per cut (`LT1.6`). About 70 prose mentions of
  messaging remain in `packages/*/docs`, `docs/setup` and `docs/infra`; the heaviest are
  `packages/infrastructure/docs/reference/partitions.md`, `packages/api-server/docs/reference/router.md`
  and `packages/infrastructure/docs/reference/notification-recipients.md`.
  `LT1.2` adds widget prose to the sweep: the §30 rows in `docs/opinions/index.md` and
  `docs/opinions/visibility.md`, "thirty-one" in `docs/setup/26-hygiene-and-ci.md` (and its §30
  section), the `widget.tsx` line in `docs/setup/28-folder-structure.md`, the `widget_preferences`
  sentence in `partitions.md`, and `packages/permissions/docs/reference/flag-registry.md`.
- **Tenant export and delete stay** (decided 2026-09-30, recorded under `LT1.3`). They moved from
  the dropped storage page to `platform/accounts.tsx`.
- **The tenant Activity page left with analytics** (`LT1.4`): it read only ClickHouse. Lite has
  no activity view until analytics is ported back.
- **Compose is the lite stack** since `LT2.5`: five containers, one Redis, no pooler.
- **A tenant delete keeps its 30-day archive; archived notifications went** (decided
  2026-10-01, recorded under `LT2.3`).
- **A permission key leaves with its last procedure**, not in `LT1.5`: §28 fails on a key nothing
  asserts. `LT1.3` removed seven platform keys this way; `LT1.5` covers the rest.
- **A flag spec declares its own flag.** Lite has none, so `application/tests/support/example-flag.ts`
  stubs `FlagRegistry.instance` with `example.rollout`. `FlagRegistry` itself stays the big kit's file.

## Picking it up

```bash
cd loadbearing_mini                       # wherever the clone lives
cp .env.example .env
pnpm install
pnpm infra:up
pnpm build:packages                       # before db:migrate — it imports dist/
pnpm db:migrate && pnpm db:seed
pnpm --filter @loadbearing/web build      # generates the route tree typecheck needs
pnpm -r --no-bail run typecheck
CI= node tooling/scripts/check-architecture.mjs
```

### How each cut was done, and should be done again

1. Delete the slice's own files (`git ls-files | grep` for its names; keep `docs/scale/<slice>.md`).
2. Fix references **bottom-up in layer order**: permissions → contracts → content → application →
   infrastructure → composition → auth / api-server → api-client → query → feature → apps.
3. **Rebuild before typechecking downstream:** `pnpm --filter "@loadbearing/<pkg>^..." run build`.
   `tsc` resolves workspace packages from `dist/`, so a stale build hides errors — `application`
   "passed" once while still importing two removed types.
4. Where a spec used the slice as *an example* of a general property, re-point it at a remaining
   table or module (notifications, docs, `activity_log`, the `doc` module) with the same assertions.
   Delete only what tests the slice itself.
5. `pnpm -r --no-bail run test` — plain `pnpm test` stops at the first failing package and hides
   the rest.
6. Repoint docs links to removed files with the upstream-links pass: a link becomes a GitHub URL at
   `3fafa78c`, a backticked path gains `upstream:`. (The script lived in the session scratchpad;
   rewrite it as a tooling script when `LT5.6` needs it again.)
7. `pnpm exec biome check --write .`, tick the plan item with a `done:` note, commit one step.

## Traps that cost time

- **A database migrated before `LT2.8` cannot take the baseline**: its drizzle journal names the
  old 52 migrations and `0000_lite_baseline` would recreate tables that exist. Run
  `pnpm infra:reset`, then `pnpm infra:up && pnpm db:migrate && pnpm db:seed`.
- **`.env.example` ships `AUTH_SECRET=change-me`**, which the web app's schema refuses (it wants
  32 characters), so `/` answers 500. Put `openssl rand -hex 32` in the local `.env`.
- **`boot-smoke.mjs` reads no `.env`**: CI passes the environment. Locally it is
  `node --env-file=.env tooling/scripts/boot-smoke.mjs <worker|web|realtime>`, after each app's
  build. `pnpm smoke` does read `.env`.
- **Recreating the stack after `LT2.5`** needs `node tooling/scripts/compose.mjs up -d
  --remove-orphans`: the old `redis-cache` container holds port 26379, which `redis` now wants.
- **Docker Desktop hung once mid-run**: `docker ps` never returned and Postgres accepted connections
  without answering, which surfaced as test timeouts everywhere. Restart Docker, `pnpm infra:up`,
  rerun. The composition health specs time out the same way.
- **The partition DDL generator validates table names against the allowlist**, so its specs fail
  when a removed table is used even as a string. `partition-ddl.spec.ts` now uses `notifications`
  (two-level) and `doc_spaces` (tenant only).
- **The messaging tables still exist in the local database** (migrations `0000`–`0051` are
  unchanged until `LT2.8`). Harmless, but `pnpm infra:reset` before `LT2.8`'s verification.
- **Commit messages carry no AI or co-author trailer** — `docs/ai/rules/workflow.md` wins over any
  tool default.
