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

**Next, in order:** Phase 4 from `WM4.1`; `WM3.9` (the access overview) waits for `WM4.5`.

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
- **`.claude/scheduled_tasks.lock`** is agent scratch. Never commit it.
