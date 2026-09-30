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
| after `2b67ae4` | `LT2.1`: the tenant-move machinery removed, the shard seam kept |

**Done:** Phase 0 (`LT0.1`–`LT0.5`), `LT0.3`, `LT5.4`, `LT1.1`, `LT1.2`, `LT1.3`, `LT1.4`, `LT1.5`, `LT2.1`, and the `docs/plans/` exemption from `LT5.1`.

**Next, in order:** `LT2.2` partitions, then the rest of Phase 2; `LT1.6`, the docs sweep, after it.

**The remote is `origin`** (GitHub). `main` matched it at `25cd0b0`; nothing after that is pushed.

## What is verified after `LT2.1`

Checked on Linux (Node 24, pnpm 11, Docker 29) against a fresh `infra:up`, `db:migrate` and `db:seed`.

- Typecheck clean in every package; `pnpm lint` clean apart from one warning that was already
  there (an unused import in `feature/src/rbac/effective-permissions.inspector.tsx`).
  `check:contrast`, `deps:check` and `repo:check` green.
- Tests, per package: application 323, infrastructure 329 (one known failure, below), query 64,
  web 65, worker 56, permissions 69, contracts 58, composition 68, feature 161, auth 71, ui 103,
  tooling 140, and every other package green. The drop since `7f88b41` is the widget, zone and
  dashboard specs, then the specs of the four platform pages' use-cases and the shard-map panel,
  then the analytics consumer, ClickHouse, replay-reader and activity-trend specs, then the
  relocate and reclaim specs.
- `check:architecture`: 29 of 30. §30 left with widgets and §31 kept its number. **The red one is
  expected** — "every partitioned table is on the allowlist" reads migrations `0023` (the three
  messaging tables) and `0047` (`widget_preferences`). `LT2.8` regenerates the baseline and clears
  it. Do not add an exemption.

### Known failures that are not defects

1. `packages/infrastructure/tests/cold/pg-partition-archive.gateway.spec.ts` needs a signed-up user
   on a fresh database. It leaves with retention in `LT2.3`.
2. `tooling/scripts` ends with `Timeout calling "onTaskUpdate"` although every test passes. The big
   kit does the same at the cut commit. `BACKLOG.md` `BL.1`. It did not appear on the Linux run.

## Decisions taken since the plan was written

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
- **Compose is partly trimmed already**: `LT1.4` removed the `clickhouse` service and `LT2.1`
  the `sharded` profile. Loki, Alloy,
  pgbouncer and the second Redis still start with `infra:up`, and nothing reads them; they go in
  `LT2.4` and `LT2.5`.
- **A permission key leaves with its last procedure**, not in `LT1.5`: §28 fails on a key nothing
  asserts. `LT1.3` removed seven platform keys this way; `LT1.5` covers the rest.
- **A flag spec declares its own flag.** Lite has none, so `application/tests/support/example-flag.ts`
  stubs `FlagRegistry.instance` with `example.rollout`. `FlagRegistry` itself stays the big kit's file.

## Picking it up

```bash
cd loadbearing_mini                       # wherever the clone lives
cp .env.example .env                      # then set ALLOY_PORT=22345 — see the traps
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

- **`ALLOY_PORT` 12345 is the one unshifted port** and collides with the big kit's Alloy. Set
  `ALLOY_PORT=22345` in the local `.env`; Alloy leaves in `LT2.4`.
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
