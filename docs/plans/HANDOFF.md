---
title: Handoff
description: Where the wiremap build stopped, what is verified, and exactly how to pick it up on any machine or in a fresh session.
---

# Handoff

**Read this page first, then [`WIREMAP-PLAN.md`](WIREMAP-PLAN.md).** The plan holds every decision
and every open item. This page holds the state of the tree and the traps that cost time.

## Where it stands

| Commit | What |
|---|---|
| `ea3e7c4` | The lite kit, as cloned (the `kit` remote) |
| `c02ec77` | `WM0.1`–`WM0.4`: the plan, identity, `4xxxx` ports, English only |
| after `c02ec77` | Phase 1: consumers shared by both hosts, the Cloudflare queue and dispatcher, polling, B2 options, deployment docs |
| after Phase 1 | Phase 2: the `wiremap` theme, shell primitives, the top bar, settings layout, landing page |
| after Phase 2 | Phase 3: viewer role, removal, invite links, domains, teams, ownership transfer, owner delete, GitHub sign-in, audit log |
| after Phase 8 | Phase 9 (in progress): Ask end to end, AI settings, encrypted keys. Owed: `WM9.7` docs pass and a real-key check |
| after Phase 7 | Phase 8: insights, change impact, compare |
| after Phase 6 | Phase 7: the graph explorer (view model, ELK in a worker, URL state, search, node detail, overview, saved views) |
| after Phase 5 | Phase 6: scans, the runner protocol and workflow, push and schedule triggers, CLI upload, the scans page |
| after Phase 4 | Phase 5: the graph document, `@loadbearing/graph`, `@loadbearing/analyzer` with four framework plugins, and the `wiremap` CLI |
| after Phase 3 | Phase 4: projects and repositories, per-project access through the goal scope, the GitHub App provider, installations, webhook and setup routes, project delete |

**Next, in order:** finish `WM9` (record it in the plan, a real-key check), then Phase 10.

**Remotes.** `origin` is `github.com/sami999khan999/wiremap`. `kit` is
`github.com/ParentPlaceholderOrg/loadbearing_mini`, kept so kit fixes can be fetched and ported.

## What is verified

On Linux (Node 24, pnpm 11, Docker), against a fresh `infra:up`, `db:migrate` and `db:seed`:

- After Phase 1: typecheck clean in every package, every suite green, `check:architecture` 31 of
  31, Biome and ESLint clean.
- The dispatcher round trip, by hand: see `TESTS.md`, row `WM1`.

## Decisions taken since the plan was written

- **Host ports carry a `4` prefix** (Postgres 45432, Redis 46379, MinIO 49000/49001, SMTP 41025,
  Mailpit 48025, web 43000), and the compose project is `wiremap`. On this machine the kit's own
  stack holds `2xxxx` and another project holds `3xxxx`.
- **The kit's setup walkthrough (`docs/setup/`) is left as the kit wrote it.** Where it names a
  file wiremap removed, a line says so rather than rewriting the walkthrough.

- **Local `.env` runs `QUEUE_DRIVER=cloudflare`** with `pnpm dev:web` and `pnpm dev:dispatcher`
  side by side. `QUEUE_DRIVER=bullmq` with `pnpm dev:worker` works too.

- **Seeing the app headless:** `scratchpad`-style CDP scripts drove `google-chrome-stable
  --headless=new` to sign in and screenshot. Worth turning into `tooling/scripts/` if it keeps
  being needed.

## Picking it up

```bash
cp .env.example .env                      # then a real AUTH_SECRET: openssl rand -hex 32
pnpm install
pnpm infra:up
pnpm build:packages                       # before db:migrate — it imports dist/
pnpm db:migrate && pnpm db:seed
pnpm --filter @loadbearing/web build      # generates the route tree typecheck needs
pnpm -r --no-bail run typecheck
CI= node tooling/scripts/check-architecture.mjs
pnpm -r --no-bail run test                # not `pnpm test`: that stops at the first red package
```

## Traps that cost time

- **`.env.example` ships `AUTH_SECRET=change-me`**, which the web app's schema refuses, so `/`
  answers 500. Put `openssl rand -hex 32` in the local `.env`.
- **Rebuild before typechecking downstream:** `tsc` resolves workspace packages from `dist/`, so a
  stale build hides errors. `pnpm --filter "@loadbearing/<pkg>^..." run build`.
- **Commit messages carry no AI or co-author trailer.** `docs/ai/rules/workflow.md` wins over any
  tool default.
- **A migration that grants a key shows up within a minute, not at once.** Capability sets are
  cached for 60 s per user (`CapabilityCache`), and a running dev server also needs a restart to
  know a new key at all.
- **A Python edit after Biome has reformatted a file can match nothing and say nothing.**
  Assert the old text is present (`assert old in s`) or replace by locating the method's
  boundaries; a silent no-op cost a debugging round in Phase 5.
- **Local scan smoke:** an API key (`project.scan.run`, `project.graph.read`) and
  `node apps/cli/dist/index.js scan <dir> --project <slug> --server http://localhost:43000 --api-key …`
  exercises the whole upload path without a GitHub App.
- **No Preflight in the app**, so a raw `<button>` keeps browser chrome: start from
  `PLAIN_BUTTON` (`feature/src/graph/role-tone.ts`), and style a state with a variant
  (`aria-pressed:`, `data-[status=active]:`), never a plain class that competes with another.
- **Integration specs must not leave pending outbox rows**: `pg-outbox.spec.ts` drains globally.
  Found an organization with a no-op activity logger unless the spec reads the audit trail.
- **Query results that cross packages are annotated with their DTO type** (`const items:
  readonly ProjectDto[] = ...`). Unannotated, a branded id arrives as `any` through `query`'s
  `.d.ts`, `tsc` stays quiet and only ESLint's unsafe-assignment rule notices.
- **`.claude/scheduled_tasks.lock`** is agent scratch. Never commit it.
