---
title: Handoff
description: Where the wiremap build stopped, what is verified, and exactly how to pick it up on any machine or in a fresh session.
---

# Handoff

**Read this page first, then [`SELF-HOSTED-PLAN.md`](SELF-HOSTED-PLAN.md) and
[`WIREMAP-PLAN.md`](WIREMAP-PLAN.md).** The plans hold every decision and every open item. This
page holds where the work stopped, the state of the tree, and the traps that cost time.

## Where we left off (2026-10-04)

**Both plans are built.** [`WIREMAP-PLAN.md`](WIREMAP-PLAN.md) is done through `WM12`, and
[`SELF-HOSTED-PLAN.md`](SELF-HOSTED-PLAN.md) through `SH6`, except the two items below. The last
CI run on `main` passed every job: `verify`, `compose`, `audit`, and `container` on both amd64 and
arm64.

**How it is meant to run now: one Docker container on the owner's machine.** The free-tier cloud
deploy stopped because the Cloudflare account had used all five free cron triggers on other
Workers. The owner chose to self-host instead.

```bash
docker build -f docker/wiremap/Dockerfile -t wiremap .
docker run -d --name wiremap -p 127.0.0.1:43000:43000 -p 127.0.0.1:48025:48025 -v wiremap-data:/data wiremap
```

Everything about it is in [`docs/infra/self-hosted.md`](../infra/self-hosted.md).

**Open, in this order:**

1. **`SH4.4`, owed by hand: a real scan inside the container.** It needs a GitHub App registered
   for `localhost` ([`github-app.md`](../infra/github-app.md), "On your own machine"), whose keys
   go in the container's env file. Then connect a repository, scan it, push, and watch the hourly
   poll scan the push. Nothing has yet been scanned from a real GitHub repository. The other
   by-hand checks are in [`TESTS.md`](TESTS.md), row `SH`: a Cloudflare Tunnel with live webhooks,
   and an Apple Silicon Mac.
2. **`SH6.4`, the owner's decision: the cloud resources from the free-tier attempt.** They are
   live and cost nothing as they are. Keep them for a cloud deploy later, or delete them:

   | Where | What |
   |---|---|
   | Neon, organization `org-damp-sun-96614563` | project `cool-truth-78829166` (`aws-us-east-1`), migrated and seeded |
   | Vercel | project `wiremap`, linked from `apps/web/.vercel/`, never deployed |
   | Cloudflare | Worker `wiremap-dispatcher` (`wiremap-dispatcher.prodigycorp.workers.dev`) with its two secrets, queues `wiremap-jobs` and `wiremap-jobs-dead`, and no cron trigger |

   Their credentials and the generated production secrets are in `.env.production` at the repository
   root (gitignored, `0600`). The Upstash, B2 and SMTP lines in it are still `FILL`.
3. **Publishing**, once the owner picks a licence: the CLI to npm (`pnpm --filter @loadbearing/cli
   pack:npm`, then `npm publish` from `apps/cli/dist/npm`) and the VS Code extension
   (`pnpm --filter wiremap-vscode package`). Both say `UNLICENSED` until then.

**State of this machine** (it does not travel with the repository):
- The dev stack (`pnpm infra:up`, compose project `wiremap`) is running.
- The image `wiremap:latest` (976 MB) is built. No wiremap container is running; the test
  container and its volume were removed.
- The agent's scratch files (screenshots, the local test account, an API key) were wiped
  between sessions. A new local account is made by signing up and reading the mail in Mailpit.

**Commit `19b6729`** (`feat(webhooks)`) was made outside the agent session from staged work.
Its scope is not in the commitlint list. It is left as it is.

## How it got here

| After | What |
|---|---|
| `ea3e7c4` | The lite kit, as cloned (the `kit` remote) |
| `c02ec77` | `WM0.1`–`WM0.4`: the plan, identity, `4xxxx` ports, English only |
| Phase 0 | Phase 1: consumers shared by both hosts, the Cloudflare queue and dispatcher, polling, B2 options, deployment docs |
| Phase 1 | Phase 2: the `wiremap` theme, shell primitives, the top bar, settings layout, landing page |
| Phase 2 | Phase 3: viewer role, removal, invite links, domains, teams, ownership transfer, owner delete, GitHub sign-in, audit log |
| Phase 3 | Phase 4: projects and repositories, per-project access through the goal scope, the GitHub App provider, installations, webhook and setup routes, project delete |
| Phase 4 | Phase 5: the graph document, `@loadbearing/graph`, `@loadbearing/analyzer` with four framework plugins, and the `wiremap` CLI |
| Phase 5 | Phase 6: scans, the runner protocol and workflow, push and schedule triggers, CLI upload, the scans page |
| Phase 6 | Phase 7: the graph explorer (view model, ELK in a worker, URL state, search, node detail, overview, saved views) |
| Phase 7 | Phase 8: insights, change impact, compare |
| Phase 8 | Phase 9: Ask (grounding, streaming, citations), AI settings, the encrypted-secret port |
| Phase 9 | Phase 10: comments, mentions, notes, the project feed, scan and finding notifications |
| Phase 10 | Phase 11: the public REST API, CLI login and npm package, the GitHub Action, the MCP server, the VS Code extension, outgoing webhooks and Slack |
| Phase 11 | Phase 12: the security review and its fixes, deletion that leaves nothing, the privacy page, the full gate |
| Phase 12 | The free-tier deploy attempt (Neon, Vercel, Cloudflare), stopped on the cron limit |
| that | Self-hosted, `SH0`–`SH6`: storage through the web app, the worker reading the App, scan and encryption settings, the single image under s6, branch polling, backups and restore, a compose file, CI on amd64 and arm64 |

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
- **`pnpm deploy --legacy` is not self-contained.** It links workspace packages back to their
  source folders. Never prune its output with `find -L … -exec rm`, which follows those links
  into the real sources. The image bundles the worker and the database scripts with esbuild
  instead.
- **`process.env` exemptions live in two lists** that must agree: Biome's `noProcessEnv`
  override in `tooling/biome-config/src/base.json`, and `ENV_EXEMPT` in `check-architecture.mjs`.
  The pre-push hook runs the lint, so a script outside them blocks the push.
- **The worker builds its own container from its own `env.ts`.** A setting only the web app reads
  (the GitHub App, `SCAN_RUNNER`, the encryption key) silently does nothing on the BullMQ path.
  That is how self-hosted scans and webhook deliveries were broken until `SH2`.
- **Reaching Neon from Node on this machine** needs `NODE_OPTIONS="--dns-result-order=ipv4first
  --no-network-family-autoselection"`. IPv6 is unreachable, and the dual-stack race times out
  the IPv4 attempt.
- **In the Vite dev server only,** a request right after a refused oversized upload (413) can
  get a 500 page, because Vite has just cut that connection. A second later it answers normally.
- **`mise` reads `XDG_CONFIG_HOME`,** so overriding it for a CLI test breaks the `node` and
  `npx` shims. Run `node` by its real path (`node -e 'console.log(process.execPath)'`).
- **Docker builds report their own exit status only when asked.** `docker build …; echo exit $?`
  prints `$?` of the build, but a trailing `echo` in a background job's command always exits 0.
