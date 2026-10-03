---
title: Tests to run
description: Every test run the lite kit build still owes, by plan item, with the commands, so the build can go ahead on typecheck alone and the runs can be done in one pass.
---

# Tests to run

## Wiremap

Every suite runs as each phase closes, so most rows below are runs that need something a laptop
cannot give: a real account, a real deploy.

| Item | What was run | Still owed | Status |
|---|---|---|---|
| `WM0` repository | Full standard pass, 2026-10-03: typecheck, every suite, 31 of 31 | — | [x] |
| `WM11` integrations | 2026-10-03: application 435 (graph queries from the scan with one read, impact and its routes, `NOT_FOUND` to a non-reader; webhooks: secret once and encrypted, one job per wanting webhook with a colon-free id, signed delivery, retry and switch-off at twenty, Slack escaping), infrastructure (the sender's signature, private and loopback refusal, no redirects; `webhooks` against Postgres including the one-statement failure count), cli 11 (login, credential order, logout; the MCP server's handshake, tools and errors), vscode 6, 31 of 31. On the local stack: every `/api/v1` read with a key, `401` without, `404` for a non-public procedure, `429` past 120 a minute; the packed CLI installed from its tarball, logging in from stdin, `whoami`, `logout`; `wiremap mcp` driven as a client from a file and from the project; the `.vsix` installed into an isolated profile and its bundle activated against a fake host; a webhook created, its URL and secret `v1:` ciphertext at rest, a test to `127.0.0.1` refused unsent; the settings page at 1440 and 375 px | Publishing `wiremap` to npm and the extension to the Marketplace (owner accounts, and a licence); the Action run in a real workflow; `claude mcp add` in Claude Code and Cursor's config; a real Slack incoming webhook and a real endpoint verifying the signature; a delivery switched off after twenty failures over real retries | [ ] |
| `WM10` collaboration | Full pass, 2026-10-03: application 425 (threads, author-only edits, admin removal, the feed row; the project feed answering `NOT_FOUND` to a non-reader; mentions and replies delivered only to readers of the project), infrastructure 365 (`comments` against Postgres: listing, edits, soft delete keeping replies, the project sweep), feature 200 (mention parsing and encoding, folder roll-up of marks), web 69, 31 of 31 architecture assertions. On the local stack: a comment, a reply forced onto its root's target, a pin, the list, the project feed showing both, and `/go/project/<id>` answering 307 to the slug page. Headless: the thread under a node, the notes in the overview, the activity page | By hand with two accounts: an `@` mention reaching the other in-app and in Mailpit; a mention of someone outside a restricted project delivering nothing; a reply notifying the thread's author; the bell's link landing on the node; a failed scan notifying the requester | [ ] |
| `WM9` Ask | 2026-10-03: application specs (grounding by name with neighbours and routes, streaming with contents fetched at the scanned commit, the answer cache, Ask off, settings encrypting the key and never reading it back). On the local stack with a made-up key: settings saved, the key at rest is `v1:` ciphertext with the plaintext nowhere in it, Ask reported available, and a question reached Gemini and ended in a clean `UNAVAILABLE` stream event when the key was refused | By hand with a real Gemini key: an answer streaming with citations that select nodes; Stop; the onboarding summary written once per scan; the 20-an-hour limit; a rotation with `SECRET_ENCRYPTION_KEYS_RETIRED` | [ ] |
| `WM8` insights | 2026-10-03: feature 195 (the insights sections linking into the graph, impact by distance with affected routes, compare across two documents). Headless on the realworld and fixture scans: impact on `user.service.ts` (9 dependents, 5 routes), the drawn cycle, a compare of two scans | By hand: following a path from insights into the explorer; comparing two branches' latest scans | [ ] |
| `WM7` graph explorer | 2026-10-03: feature 192 (the view model: grouping, edge aggregation with counts and certainty, expansion, role and impact dimming, filters, a 5,000-file build in the budget; the URL round trip; the ELK conversion and grid), application 414 (saved views). Headless on a real scan of `nestjs-realworld` uploaded through the CLI: the three panes, folder nodes with badges laid out by ELK in its worker, an expanded folder, a selected file with imports, importers and routes, a role highlighted from the URL, the partial banner and the overview's routes | By hand: Cmd-K search and Enter centring the node; saving a view, opening it from the menu, and removing it as another member; pan and zoom at 60 fps on a 5,000-file scan; dragging the panel dividers | [ ] |
| `WM6` scans | 2026-10-03: application 413 (queue dedupe, the protocol's state gates and token, completion from the graph read back with the findings diff, failure, the sweep, push targets, a project-scoped API key), infrastructure 361 (`scans` and `scan_findings` against Postgres; the token pinned to the `openssl` derivation `scan.yml` uses; the archive refusing missing, foreign and wrong-version graphs; the dispatch call), cli 3. End to end on the local stack: `wiremap scan` on the NestJS fixture with an API key created presigned PUT to MinIO, read back, scan succeeded; `scan.graph` returned a link whose response carried CORS and parsed. Headless: the scans page and the overview at 1280 and 375 px | By hand, once an App and runner exist: "Scan now" on GitHub Actions end to end; a push to a tracked branch; a daily schedule over two ticks; a broken tsconfig failing with its message; the local runner (`SCAN_RUNNER=local`, CLI built, `git` installed). `pg-outbox.spec.ts` was flaky under the full parallel run: the drain is global and new specs left pending rows. Fixed in Phase 7 (those specs write no audit rows; the drain assertions are tenant-scoped) | [ ] |
| `WM5` graph format and analyzer | 2026-10-03: contracts 60, graph 6 (with the 20,000-file benchmark), analyzer 11 (NestJS, Next.js, TanStack Start, Laravel and pnpm-monorepo fixtures, each with routes at file and line and a golden `GraphDocument` in `tests/golden/`), cli 3. The bundled CLI on a clone of `lujakob/nestjs-realworld-example-app`: 21 routes, "Graph is partial: 72 of 76 imports into this repository resolved (95%)" (the four are its gitignored `config.ts`), one cycle, nine unguarded routes once its `forRoutes` middleware is read | By hand: `--artisan` on a real Laravel app with PHP and `vendor/` installed; a Next.js app using a Clerk-style `matcher` regex; a large monorepo for the time budget | [ ] |
| `WM4` projects and repositories | Full pass, 2026-10-03: application 403, infrastructure 354 (goal-scope matrix: org default, direct and team grants, the viewer cap, deleted projects, four statements; the App provider's JWT, state, webhook signature and token narrowing against a fake fetch), composition 108. Headless as an owner: `/projects` empty and with one project, `/projects/new` with no App configured, a project page and its settings tabs, 375 px with no horizontal scroll | By hand, once an App is registered (`docs/infra/github-app.md`): install it from `/projects/new` and land back connected; pick two repositories; restrict the project and check a member without a grant gets the not-found page while a team grant opens it; rename a repository on GitHub and see the project follow; uninstall and see the installation gone | [ ] |
| `WM3` organizations and access | Full pass, 2026-10-03: application 395, infrastructure 344 (the new Postgres spec: teams, member removal, link and domain claims, the audit reader), auth 73, composition 108. Headless: `/settings/organization`, `/settings/members`, `/settings/audit` as an owner | By hand: a second account joining through a link (and the link refusing once used up); a sign-up at a claimed domain joining automatically; a transfer and an owner's delete end to end; GitHub sign-in once the App's OAuth pair exists. **Restart the web process after a deploy that adds permission keys**: a running process keeps the registry it booted with, and refuses keys it does not know | [ ] |
| `WM2` brand and shell | Full pass, 2026-10-03: ui 134, feature 185. Headless Chrome, signed in: the top bar at 1356 and 375 px with no horizontal scroll; the organization menu opens and lists the membership, its role and the settings and new entries; the landing page and the phone-width sign-in | **By hand in your own Chrome:** the organization menu froze the tab twice in a profile with Grammarly and ColorZilla installed, while the account menu worked and the same menus opened and closed cleanly in a clean headless Chrome over repeated cycles. Open both menus several times with extensions on, then off, and note which state freezes | [ ] |
| `WM1` free-tier platform | Full pass, 2026-10-03: every package green (composition 108, dispatcher 14). By hand with `QUEUE_DRIVER=cloudflare` and `wrangler dev`: a sign-up's verification mail reached Mailpit through the dispatcher, and the hourly and nightly crons ran their six jobs in the web app | The first real deploy, following `docs/infra/deployment.md` in order: Neon, Upstash, B2 (checksums `required`, SSE-B2, the `export/` rule, CORS), SMTP, Vercel, the Worker. Then its section 8 checks | [ ] |

## Inherited from the kit

From `LT2.6` on, the build goes ahead on typecheck and `check:architecture` alone, and the owner
runs the tests. This page lists every run still owed. Tick a row when it has passed; if it fails,
add a line under it saying what failed.

**Last full pass:** `d7ba5b3` (`LT2.5`), 2026-10-01. Every package's suite, `pnpm smoke` and
`boot-smoke.mjs` for all three apps were green. The only red `check:architecture` assertion is the
partition allowlist, which `LT2.8` clears.

## The standard pass

Run the whole block after any item below, and again once at the end.

```bash
pnpm install
node tooling/scripts/compose.mjs up -d --remove-orphans   # five containers
pnpm build:packages
pnpm --filter @loadbearing/web build
pnpm db:migrate && pnpm db:seed
pnpm -r --no-bail run typecheck
pnpm lint
pnpm -r --no-bail run test          # not `pnpm test`: that stops at the first red package
CI= node tooling/scripts/check-architecture.mjs
pnpm check:contrast && pnpm deps:check && pnpm repo:check
pnpm smoke                          # needs the containers
pnpm --filter @loadbearing/worker build && pnpm --filter @loadbearing/realtime build
for app in worker web realtime; do node --env-file=.env tooling/scripts/boot-smoke.mjs $app; done
```

The local `.env` needs a real `AUTH_SECRET` (`openssl rand -hex 32`); the template's `change-me` makes
the web app answer 500.

## Owed, by item

| Item | What to run | Status |
|---|---|---|
| `LT2.6` env | The standard pass. No code changed, so this only confirms nothing regressed. | [ ] |
| `LT2.7` worker | The standard pass. `apps/worker` tests and `boot-smoke.mjs worker` matter most: a consumer or schedule removed there shows up only when the process boots. | [ ] |
| `LT2.8` baseline | Done already: the file applies to an empty database, and the table list matches the old one minus the eight cut tables. Still owed: `pnpm infra:reset` (required — the local journal names the old 52 migrations), then `pnpm db:migrate && pnpm db:seed` on the new `0000_lite_baseline.sql`. Diff `pg_dump --schema-only` of that database against one from before the cut, minus the cut tables. `check-architecture` passes all 30 as of `LT2.8`. The infrastructure suite runs against the new schema. | [ ] |
| `LT1.6` docs | `CI= node tooling/scripts/check-architecture.mjs`, since §15 checks every path the docs name. Then `grep -ri "messag\|widget\|zone\|clickhouse"` should find only notification transport and back-port notes. Then run the commands the sweep rewrote without running: the `mc` calls in `docs/infra/reference/minio.md` (through `minio-init`, since the server image has no `mc`), the `docker compose ps` states in `docs/infra/index.md`, and the `flushall` warning in `docs/infra/reference/redis.md`. | [ ] |
| `LT3` owner audience | The standard pass, plus `packages/application/tests/doc/doc-access.spec.ts`. The manual check with alice, bob and a signed-out visitor is below. | [ ] |
| `LT4` search | The standard pass, plus `tests/ai/search-documents.spec.ts` (application), `tests/gemini/gemini-embedding.provider.spec.ts` and `tests/vector/pg-vector.store.spec.ts` (infrastructure). Migration `0002` runs with the standard pass. Then set `EMBEDDING_PROVIDER=gemini` and a key, index a document, run `pnpm ai:reindex` after switching to `openai`, and check the old chunks are searched again. The manual check in all three modes is below; it needs real Gemini and OpenAI keys. | [ ] |
| `UI` Tailwind and Base UI | The standard pass, then by hand: `/kitchen-sink` in all six themes, light and dark, looking for anything unstyled or mis-coloured; keyboard use of `Select` and `Menu` (arrows, Home/End, typing, Escape), the popover (Escape returns focus), the command palette (Ctrl/Cmd-K, Enter follows the link), `ThemeToggle` (arrows), `Dialog` and `AlertDialog` (trapped focus, Cancel first); every form with a select in the flows below; the doc reader's popover, menus and palette in a space with its own theme. The Sidebar drawer has no focus trap, which is known. | [ ] |
| `LT5` tooling and CI | Push, then confirm CI is green on the first run. That is the plan's exit, and nothing local proves it. | [ ] |
| `DS0` docs performance | The standard pass, then `pnpm doc:bench` on a quiet machine for the `DS0.2` latency budgets; the 2026-10-02 run in `doc.md` was on a busy one. `DS0.6` (EXPLAIN specs) is still open in the plan. | [ ] |
| `DS1` access links | Specs passed 2026-10-02: `doc-feature.policy.spec.ts` (12), `read-doc-page.use-case.spec.ts`, the access round-trip in `pg-doc-page.repository.spec.ts`, the trimNav specs. By hand on 2026-10-02, with a page linked to `rbac.role.manage`: the owner reads it; signed out, it is absent from the sidebar, the nav endpoint and `/llms.txt`, and `/docs/guide/roles` and `/api/doc/guide/roles` both answer 404. Still owed by hand: a member without the permission, a `module: apikey` link on a plan with and without it, a plan link, and a flag link once a flag exists. | [ ] |
| `DS2` whole-docs search | Specs passed 2026-10-02: `doc-search.spec.ts` (application), `doc-search.panel.spec.tsx` (feature). By hand: the palette found hits on several pages of a space. Still owed: hits from a second readable space, grouped under its name. | [ ] |
| `DS3` reading aids | `doc-reader.panel.spec.tsx` and `nav-tree.spec.tsx` passed 2026-10-02. Breadcrumbs, the pager, collapsible sections and the space icon were checked by hand in the reader. | [x] |
| `DS4` Markdown blocks | Renderer and prose specs passed 2026-10-02. `pnpm doc:rerender` ran end to end: 2004 pages moved to version 3, and a second run did nothing. Tabs (arrow keys), steps, accordions and card icons were checked on `/kitchen-sink` and in the reader. | [x] |
| `DS5` repository and Open in AI | `doc-reader.panel.spec.tsx` passed 2026-10-02. By hand: the GitHub icon sits in the sidebar footer; Open offers Markdown, ChatGPT and Claude on a public page, and only Edit on a linked one. Still owed: following each link to confirm the AI tool fetches the page. | [ ] |
| `DS6` visual pass | Checked 2026-10-02: the reader in all six themes, light and dark (midnight is dark only), against the reference in `graphite` dark; `/kitchen-sink` Doc blocks; 375 px wide with no horizontal scroll. | [x] |

## Manual checks, at the end

From the plan's verification section. Users alice, bob and carol (`Correct-Horse-9`), web on
port 23000, mail in Mailpit on 28025, with the worker running.

- [ ] Sign up and verify through Mailpit, which shows that the worker's mail path works.
- [ ] Invite a user to an org and grant a role. Enable 2FA and create an API key.
- [ ] Toggle a flag and an entitlement in platform admin.
- [ ] As a platform admin, export a tenant, then delete one on the accounts page. After a delete, its
      `cold/` objects stay for 30 days and `pnpm db:partitions --sweep <id>` removes them early.
- [ ] The dashboard shows the module nav and the member count, and the bell only for members who
      hold `notification.inbox.read`.
- [ ] The docs audience matrix from `LT3`.
- [ ] AI search in all three modes from `LT4`. With `none` there are no outbound calls.
- [ ] A notification arrives in realtime.
