---
title: Wiremap plan — a codebase graph explorer built on the lite kit, on free-tier infrastructure
updated: 2026-10-03
owner: sami
schema: plan/v1
source: owner request 2026-10-03 (feature list, tech stack, a "cartograph" reference screenshot); three read-only surveys of loadbearing_mini at ea3e7c4 (access, infrastructure, web + UI); two rounds of questions answered by the owner
---

# Wiremap plan

> **How to use this file**
> 1. The ID prefix is `WM`, which no other plan uses. Items are `WM<phase>.<n>`.
> 2. Checkboxes: `[ ]` todo, `[~]` in progress, `[!]` blocked, `[x]` done, `[-]` dropped. Add
>    `done: YYYY-MM-DD` when closing an item.
> 3. Phases run in order. Each item names the doc it updates.
> 4. Every new slice follows `docs/ai/skills/add-slice.md`. Commit once per layer, using
>    conventional commits with a scope. **No AI or co-author trailers.** `docs/ai/rules/workflow.md`
>    outranks any tool default.
> 5. `WM0.1` copies this file to `docs/plans/WIREMAP-PLAN.md`. From then on, that copy is the live
>    one.

---

## Context

Wiremap is a SaaS that scans a team's repositories and shows how the code is wired:
- an import graph grouped by folder;
- files classified by role;
- the routes a backend exposes, and the frontend calls that reach them;
- insights such as cycles, unused files and unguarded routes;
- an AI "Ask" assistant grounded in that graph.

Organizations, roles, invites and audit come first, because teams share projects.

**It starts from the lite kit** (`ParentPlaceholderOrg/loadbearing_mini`, `ea3e7c4`). The kit already
provides:
- auth with email, Google, 2FA and API keys;
- organizations, email invitations and RBAC with custom roles and overrides;
- plans and entitlements, flags, and notifications (in-app, email and preferences);
- an audit trail that is written but not read;
- S3 storage, Gemini embeddings and pgvector;
- the full rulebook and its `check-architecture` gate.

Wiremap adds the product on top and keeps every kit seam.

**Everything must be free of charge.** That forces the hosting shape below. Each free quota is
recorded in `docs/infra/free-tier.md` (`WM1.9`).

### Decisions recorded up front (do not re-litigate)

1. **Clone with history and keep the scope.** The repository is the kit's history plus wiremap
   commits. `origin` is `github.com/sami999khan999/wiremap`, and packages stay `@loadbearing/*` so
   kit fixes port across as file copies. Product naming lives in the UI, the docs, the root
   `package.json` name and the CLI's npm name only.
2. **English only.** `bn` is removed from the locale list. The i18n machinery stays, so another
   language is a folder.
3. **Web and API on Vercel Hobby** (free, non-commercial). Nitro uses the `vercel` preset. Moving to
   Pro is a billing change, not a code change.
4. **Background work: Cloudflare is the scheduler, Vercel is the compute.** A small Cloudflare
   Worker, `apps/dispatcher`, owns:
   - Cloudflare Queues (free: 10,000 operations a day, 24-hour retention);
   - two Cron Triggers, hourly and daily.

   It runs no business logic: each message or tick becomes an HMAC-signed `POST
   /api/internal/job` on the web app. The consumers the kit already has run there, in Node. The
   Worker never comes near the 10 ms free CPU limit. QStash is not used.
5. **The queue seam stays.** `QueuePublisher` gains `CloudflareQueuePublisher`, selected by
   `QUEUE_DRIVER=cloudflare|bullmq`. `apps/worker` and BullMQ stay as the self-hosted path and keep
   passing `boot-smoke`. Production uses the dispatcher.
6. **No realtime process.** The bell polls every 60 s, and a running scan polls every 3 s, only
   while the tab is visible.
   - `apps/realtime` is removed. `RealtimePublisher` stays as a port with a no-op adapter.
   - `docs/scale/realtime.md` is the way back.
7. **Neon must be allowed to sleep.** No cron touches Postgres more often than hourly:
   - the outbox is drained by a job enqueued after the commit that wrote the events, with an hourly
     backstop;
   - spares and partitions move to hourly and monthly ticks.
8. **Upstash Redis through the existing ioredis adapters** over `rediss://`.
   - Both `REDIS_CACHE_URL` and `REDIS_QUEUE_URL` stay. Every key still carries a TTL.
   - Better Auth's secondary storage is the largest consumer. Its command budget goes in
     `free-tier.md`.
9. **Backblaze B2 through the existing S3 adapter.**
   - Checksums are sent only when required.
   - Objects are encrypted at rest with SSE-B2.
   - The lifecycle call is skipped on B2, because B2 does not implement it over S3.
10. **The scan runner is GitHub Actions.**
    - A `workflow_dispatch` workflow runs in the runner repository, `WIREMAP_RUNNER_REPO` (by
      default the wiremap repository).
    - Its only input is a scan id. It exchanges a one-scan callback token for a read-only,
      one-repository installation token. The App's private key never leaves the server.
    - The graph is uploaded to B2 through a presigned PUT.
    - **Source code is never stored.**
    - In development, `SCAN_RUNNER=local` runs the same runner script as a child process.
11. **The graph is a file, and Postgres holds its summary.** A versioned `GraphDocument` (zod, in
    `contracts`) is stored gzipped in B2. Postgres holds the scan row, its counts and its findings,
    nothing per file. Graph algorithms live in one isomorphic package, `@loadbearing/graph`, which
    the browser, the server and the CLI share.
12. **The analyzer is its own package**, `@loadbearing/analyzer`. It is node-only, uses ts-morph
    and `web-tree-sitter` (WASM, so it needs no native build in Actions), and never reaches the web
    bundle. The CLI (`apps/cli`, npm name `wiremap`) is its only host.
13. **Per-project access is the kit's dormant goal scope.** A project id is a goal id.
    - Project keys are `goal`-scoped. `goal_members` holds per-project roles.
    - A team grant expands into the same rows at resolution time.
    - A project is `org` (every member gets its default role) or `restricted` (explicit grants
      only).
    - Owner and Admin hold project keys org-wide, so they see every project.
14. **Org roles: Owner, Admin, Member, Viewer.** `viewer` is added to `SystemRoleSeed`, and it reads
    but never writes. The kit's `guest` stays as a seam and is not offered in the role picker.
15. **Ask uses each org's own Gemini key, encrypted, or is off.** There is no platform key. The key
    is encrypted with AES-256-GCM through a new `SecretCipher` port (`SECRET_ENCRYPTION_KEY`).
    Live file contents are fetched through the GitHub App when needed, never stored, and cached in
    Redis for at most 10 minutes.
16. **Colour stays the twelve.** A new `wiremap` theme matches the screenshot (near-black, violet
    primary) and becomes the default. Role dots are a fixed set of six tones derived with
    `color-mix` from the twelve. Nothing gets a hex.
17. **Out of scope** (the owner marked these "later"): billing and the usage dashboard, GitLab and
    Bitbucket, SAML, Python, Go and Java parsers, and Express and FastAPI plugins. Each one has a
    seam (`RepositoryProvider`, `LanguageParser`, `FrameworkPlugin`) and a row under "Not in this
    plan".
18. **Verification:** each item runs typecheck, `check:architecture` and the specs it adds. The full
    standard pass runs at the end of each phase. Each phase ends with a push to `origin`.

### What exists and is reused

| Piece | Where |
|---|---|
| Slice run book, rules | `docs/ai/skills/add-slice.md`, `docs/ai/rules/*.md` |
| Orgs: create, switch | `packages/auth/src/plugin/organization.plugin.ts`, `feature/src/organization/organization-switcher.tsx` |
| Invitations | `application/src/member/*invitation*`, `invitations` table, `/invitation/$token` |
| Enrolment chain | `InvitationClaimingEnroller`, `PgPersonalOrganizationEnroller` (`AUTH_ENROLMENT_MODE`) |
| RBAC, goal scope | `CapabilitySet.can(key, goalId)`, `goal_members`, `pg-capability.repository.ts`, `SystemRoleSeed` |
| Member admin | `ChangeMemberRoleUseCase`, `SetMemberActiveUseCase`, `MemberRules.lastHolderGuard` |
| Access inspector | `role.effective`, `effective-permissions.inspector.tsx` |
| Audit write | `ActivityLogger`, `activity_log` (LIST org, RANGE month), `contracts/src/catalog/*.actions.ts` |
| Notifications | `NotificationPolicy`, `DeliverNotificationUseCase`, `notification.*` procedures, bell |
| API keys | `api_keys`, `auth/src/apikey/api-key.resolver.ts`, `Principal.apiKey` |
| Queue | `QueuePublisher` (`application/src/port/queue.publisher.ts`), `QueueName`, `apps/worker/src/consumer/*` |
| Cache, rate limit | `CacheStore`, `RateLimitStore`, `rateLimitMiddleware` (`api-server/src/router/base.ts`) |
| Storage | `StorageGateway` + `S3StorageGateway` (`infrastructure/src/s3/`) |
| Gemini over REST | `infrastructure/src/gemini/gemini-embedding.provider.ts` (the fetch pattern for chat) |
| Raw HTTP route | `apps/web/src/route/api/doc-image/$.ts` (Start server route template) |
| UI | `Sidebar`, `DataTable`, `StatusBadge`, `CommandDialog`, `Menu`, `Select`, `Tooltip`, `Dialog`, `ThemeToggle`, `ThemeRegistry` |
| Queries | `query/src/rbac/role.queries.ts` pattern, `query/src/key/query-key.ts` |
| Plans, flags | `plans`, `EntitlementMask`, `FlagRegistry` (`FLAGS` empty) |

---

## The phases

### Vocabulary fixed up front

| Thing | Name |
|---|---|
| Product | **wiremap** (UI, docs, CLI). Root package `wiremap`. |
| Subjects (slice folders) | `project`, `repository`, `scan`, `graph`, `insight`, `ask`, `comment`, `team`, `webhook`, `github` |
| Graph file | `GraphDocument`, `graphs/<organizationId>/<projectId>/<scanId>.json.gz` |
| Edge kinds | `import`, `inject` (dependency injection), `api` (frontend → backend). `certain: boolean`. |
| Scan states | `queued`, `running`, `succeeded`, `failed`, `cancelled` |
| Scan triggers | `push`, `schedule`, `manual`, `upload` |
| Project visibility | `org`, `restricted` |
| Project roles (goal) | `project_admin`, `project_editor`, `project_viewer` |
| Queue names added | `QueueName.SCAN`, `QueueName.WEBHOOK` |
| Env added | `QUEUE_DRIVER`, `DISPATCHER_URL`, `DISPATCHER_SECRET`, `INTERNAL_JOB_SECRET`, `SECRET_ENCRYPTION_KEY`, `GITHUB_APP_ID`, `GITHUB_APP_SLUG`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_WEBHOOK_SECRET`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `WIREMAP_RUNNER_REPO`, `WIREMAP_RUNNER_TOKEN`, `SCAN_RUNNER` |

### Phase 0 — The repository

- [x] `WM0.1` **Clone and re-point.**
  done: 2026-10-03. Cloned beside the session folder and moved in; `origin` and `kit` set.
  - `git clone` the kit into the empty working directory.
  - Set `origin` to `https://github.com/sami999khan999/wiremap.git` and keep the kit's URL as
    `kit`.
  - Copy this plan to `docs/plans/WIREMAP-PLAN.md`, and add a row and the page to `docs/plans/index.md`
    and `meta.json`.
- [x] `WM0.2` **Baseline green before any change.**
  done: 2026-10-03. Typecheck clean, 31 of 31; every suite green but `content`, mid-edit for `WM0.4`.
  - `cp .env.example .env` with a real `AUTH_SECRET`.
  - Then `pnpm install`, `infra:up`, `build:packages`, the web build, `db:migrate`, `db:seed`,
    typecheck and `check:architecture`.
  - Record the result in `HANDOFF.md`, which is rewritten for wiremap.
- [x] `WM0.3` **Identity.**
  done: 2026-10-03. **As built:** host ports moved to a `4` prefix and the compose project to `wiremap`, because this machine already runs the kit on `2xxxx` and another stack on `3xxxx`.
  - Root `package.json` name `wiremap`, and a new `README.md` (product, stack, running it).
  - `AGENTS.md` gets a wiremap paragraph. `UPSTREAM.md` records `ea3e7c4` as the kit commit.
  - Add commitlint scopes `graph`, `analyzer`, `cli`, `dispatcher`, `vscode`, `action`.
  - Remove `realtime` in `WM1.6`.
- [x] `WM0.4` **English only.**
  done: 2026-10-03. The kit's setup walkthrough keeps naming `bn/` where it explains adding a locale.
  - Delete `content/src/message/bn/`, drop `bn` from the locale registry, the catalog and the
    `LocaleSwitcher`.
  - Delete `bn` fixtures in specs. Docs: `packages/content/docs`.
- [x] `WM0.5` Push `main` to `origin`.
  done: 2026-10-03.

**Exit.** `origin/main` holds the kit history plus the identity commits, and the baseline gate is
green.

### Phase 1 — Free-tier platform

- [x] `WM1.1` **Vercel build.**
  done: 2026-10-03. **As built:** the pool probe reads in-memory stats on an unref'd timer, so it stays; `DATABASE_POOL_MAX=3` is set in deployment instead.
  - Nitro `preset: "vercel"` when `VERCEL` is set, Node otherwise.
  - The container skips its pool probe interval on serverless.
  - Pool size is 1–3 per instance, with Neon's pooled URL.
  - Docs: `docs/infra/deployment.md`.
- [x] `WM1.2` **Jobs as HTTP.**
  done: 2026-10-03. **As built:** the consumers moved to `composition/src/consumer/` behind `ConsumerRegistry`; the worker keeps one `BullMqQueueConsumer`, and `/api/internal/job` runs `JobEndpoint` (`web/src/server/job.server.ts`).
  - Move each consumer's `handle` behind one `JobRunner` (`composition/src/job/`), keyed by
    `(queue, name)`.
  - `apps/worker`'s BullMQ consumers and the new route `apps/web/src/route/api/internal/job.ts`
    both call it.
  - The route verifies the HMAC (`INTERNAL_JOB_SECRET`) and a 5-minute timestamp window. It
    answers 2xx when done and 5xx to ask for a retry.
- [x] `WM1.3` **`CloudflareQueuePublisher`** (`infrastructure/src/cloudflare/`).
  done: 2026-10-03. Docs: `packages/infrastructure/docs/reference/cloudflare-queue.md`.
  - It POSTs signed batches to `DISPATCHER_URL/enqueue`.
  - Mapping: `delayMs` becomes `delaySeconds`; `jobId`, `inFlightId` and `onceWithin` are
    deduplicated on the publishing side with `CacheStore.setIfAbsent` (Redis, with a TTL); `priority` is ignored and documented.
  - Selected by `QUEUE_DRIVER`. Specs use a fake fetch.
- [x] `WM1.4` **`apps/dispatcher`**, a Cloudflare Worker with `wrangler.toml`, one queue `jobs` with
  done: 2026-10-03. **As built:** three crons, not two (hourly, 03:00 maintenance, 07:00 digest), and partitions run nightly since nothing boots to run them once. Verified with `wrangler dev`: a sign-up's mail and both cron ticks ran through the web app.
  a DLQ, and two crons.
  - `fetch /enqueue` checks the signature and calls `send` or `sendBatch`.
  - `queue()` POSTs each message to `/api/internal/job`. A 5xx means `retry` with backoff, and
    8 attempts means the DLQ.
  - The hourly `scheduled()` runs the outbox backstop, scheduled scans, spares and the
    expired-grant sweep.
  - The daily one runs cleanup, digest and orphans, plus partitions on the 1st.
  - It has no dependencies besides `wrangler` (dev). `wrangler dev` runs it locally against
    `localhost:23000`. Docs: `apps/dispatcher/README.md` and `docs/infra/deployment.md`.
- [x] `WM1.5` **Outbox without a 1-second drain.**
  done: 2026-10-03. `OutboxDrainPublisher`, only under `QUEUE_DRIVER=cloudflare`.
  - A use-case that wrote outbox events publishes one `EVENT/drain` job after commit, deduplicated
    for 5 s.
  - With BullMQ, the 1-second repeatable stays.
  - Spec: an event is delivered with no schedule running.
- [x] `WM1.6` **Realtime out, polling in.**
  done: 2026-10-03. **As built:** the realtime contract, router and Redis adapters stay as the seam; `REALTIME_DRIVER=none` binds `NoopRealtimePublisher`, and `RealtimeProvider` takes `transport="poll"`. `REALTIME_MAX_STREAMS_PER_USER` and `REALTIME_STREAM_MAX_AGE_SECONDS` stay, because the mounted router still reads them.
  - Delete `apps/realtime`, `REDIS_REALTIME_URL`, `REALTIME_*` env, its compose proxy and its CI
    smoke.
  - `RealtimePublisher` gets `NoopRealtimePublisher`.
  - `query/src/realtime` becomes `refetchInterval` hooks that are visibility-aware.
  - Write `docs/scale/realtime.md` (the way back).
  - `check-architecture` and `.env.example` follow.
- [x] `WM1.7` **B2.**
  done: 2026-10-03. **As built:** `S3_CHECKSUMS=required` and `S3_LIFECYCLE=false`. Encryption at rest is the bucket's default SSE-B2, set in the console, not a header: a presigned upload would otherwise have to send it too.
  - `S3ClientFactory` sets `requestChecksumCalculation: "WHEN_REQUIRED"`.
  - `S3_SERVER_SIDE_ENCRYPTION=AES256` adds SSE. `S3_LIFECYCLE=off` skips the policy gateway call.
  - MinIO stays for development.
  - Docs: `docs/infra/reference/minio.md` and a B2 section in deployment.
- [x] `WM1.8` **Upstash and Neon.**
  done: 2026-10-03. No code: ioredis turns TLS on for `rediss://`, and a role may `ALTER ROLE` its own settings on Neon.
  - Make TLS URLs work in `RedisConnection`.
  - Document `DATABASE_URL` (pooled) and `DATABASE_DIRECT_URL` (direct) for Neon.
  - The baseline's `ALTER ROLE … SET` must be safe under Neon's owner role. Migrations run from CI
    or locally against `DATABASE_DIRECT_URL`.
- [x] `WM1.9` **`docs/infra/free-tier.md`.** One row per vendor:
  done: 2026-10-03.
  - Vercel, Cloudflare Workers, Queues and Crons, Neon, Upstash, B2, GitHub Actions minutes
    (public repo unlimited, private 2,000 a month), Gemini (the org's own key) and SMTP.
  - Each row gives the quota, what wiremap spends it on and what happens when it runs out.
- [x] `WM1.10` **Deploy docs and CI.**
  done: 2026-10-03. The kit's VPS guide moved to `docs/infra/self-hosted.md`.
  - `deployment.md` is rewritten for Vercel + Cloudflare + Neon + Upstash + B2, in order, with
    every env key.
  - CI adds `wrangler deploy --dry-run` and the dispatcher's specs.

**Exit.** Locally, with `QUEUE_DRIVER=cloudflare` and `wrangler dev`:
- an invitation mail reaches Mailpit through dispatcher → `/api/internal/job` → the mail consumer;
- the bell updates by polling.

### Phase 2 — Brand and shell

- [x] `WM2.1` **`wiremap` theme** in `ui/src/style/color/wiremap.css`, light and dark, set as the
  done: 2026-10-03. It also holds the `:root` seed, moved from `slate.css`. `check:contrast`: 182 pairings.
  default in `ThemeRegistry`. `check:contrast` passes. Docs: `packages/ui/docs/reference/palette.md`.
- [x] `WM2.2` **UI primitives.**
  done: 2026-10-03. **As built:** `ActionMenu` (actions, beside the kit's value-choosing `Menu`) carries the user menu; `UserMenu` and `OrganizationMenu` live in `feature`. Docs: `packages/ui/docs/reference/shell-primitives.md`.
  - `Tabs` (Base UI Tabs), `Avatar`, and `UserMenu` (avatar → account, security, sign out).
  - `ThemeToggle` gets a `system` segment.
  - `ResizablePanels` is a CSS-grid splitter with keyboard support.
  - `RoleDot`, with six tones derived from the twelve.
  - Each one goes in the kitchen sink and `packages/ui/docs`.
- [x] `WM2.3` **App shell.**
  done: 2026-10-03. **As built:** the top bar holds the product's modules (`doc`, `platform`; `project` from Phase 4) and `settings.tsx` holds the administrative ones, through a `modules` filter on `ModuleNav`. The layout now loads `notification` copy, which the bell's name lacked.
  - `_authenticated.tsx` becomes a top bar with:
    - the `wiremap /` wordmark;
    - the org switcher as a logo, name and chevron `Menu` (switch, new org, settings);
    - the theme toggle and the avatar menu.
  - Settings pages get a left `Sidebar` layout (`settings.tsx`).
  - The module nav moves into the org menu and the settings sidebar.
- [x] `WM2.4` **Landing and sign-in copy** for wiremap. Icons added to `asset`: `folder`, `graph`,
  done: 2026-10-03. Also `settings`, `logout`, `plus`, `monitor`, `shield`, `activity`, `layers`. Signed-out pages share `AuthFrame`; the product name is `common` `brand.name`.
  `route`, `github`, `branch`, `play`, `sparkle`, `comment`, `pin`, `team`, `webhook`.

**Exit.** Signed in, the shell matches the screenshot's top bar in `wiremap` dark, with no
horizontal scroll at 375 px.

### Phase 3 — Organizations and access

- [x] `WM3.1` **Viewer role.** It is seeded with read keys only. A migration adds it to existing
  done: 2026-10-03. Migration `0004_wiremap_access.sql` (schema plus the role data half).
  orgs. Docs: `permissions/docs`.
- [x] `WM3.2` **Organization settings.**
  done: 2026-10-03. **As built:** keys `organization.profile.update`, `organization.ownership.transfer`, `organization.delete`; activity `organization.deletion.requested` rather than `deleted`, because the job's own rows go with the tenant. Page `/settings/organization`.
  - `organization.update` (name, slug, logo URL) and `organization.delete`. Delete is owner only,
    behind a typed confirmation, and reuses `DeleteOrganizationUseCase` through the maintenance
    job.
  - `organization.transferOwnership`: in one transaction the target becomes owner and the caller
    becomes admin.
  - Activities `organization.updated`, `organization.ownership.transferred` and
    `organization.deleted`.
- [x] `WM3.3` **Shareable invite links.**
  done: 2026-10-03. **As built:** `PgInvitationLinkClaimer` behind `POST /api/auth/invitation-link/accept` (rate-limited 5 a minute); the link row is locked `for update` so the last use cannot be spent twice. `invitation_links_token_uq` joined §17's exempt list.
  - `invitation_links` (org, token hash, role, `expires_at`, `max_uses`, `uses`, `revoked_at`).
  - Procedures `member.createLink`, `member.listLinks` and `member.revokeLink`. Route
    `/join/$token`.
  - A claim needs a verified email. The role is capped by `RoleRules.assertAssignableBy` against
    the link's creator.
- [x] `WM3.4` **Remove member.**
  done: 2026-10-03.
  - `member.remove` hard-deletes the membership, guarded by the last-owner rule.
  - It also removes their goal and team rows, and clears capability caches.
- [x] `WM3.5` **Teams.**
  done: 2026-10-03. Teams are catalog tables beside `goal_members`.
  - `teams` and `team_members` (org-scoped).
  - Procedures `team.list`, `team.create`, `team.update`, `team.remove`, `team.addMember` and
    `team.removeMember`. Page `/settings/teams`.
  - Permission `member.team.manage`.
- [x] `WM3.6` **Domain auto-join.**
  done: 2026-10-03. **As built:** `PgMemberDomainClaimer`; the joiner is not notified separately, since `member.joined` already fans out to `member.invite` holders through the existing policy. `organization_domains_domain_uq` joined §17's exempt list.
  - `organization_domains` (org, domain, `auto_join_role`).
  - A domain can be claimed only by an admin whose own verified email is at that domain. Public
    mail domains are refused from a frozen list.
  - `DomainJoiningEnroller` sits after `InvitationClaimingEnroller`. A verified sign-up at a
    claimed domain joins as that role.
  - The joiner is notified, and so are the org's `member.invite` holders.
- [x] `WM3.7` **GitHub sign-in.**
  done: 2026-10-03. Account linking now trusts `github` too.
  - `socialProviders.github` in `AuthFactory` when `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET`
    are set (the App's OAuth credentials).
  - A button in `social-sign-in.tsx`, and an entry in the linked accounts list.
- [x] `WM3.8` **Audit log.**
  done: 2026-10-03. **As built:** the key is `audit.log.read` in a new `audit` module, because `core.*` keys are held by every principal. The reader is `local` and names come from `UserReader` in one call.
  - `ActivityReader` port and `PgActivityReader`, keyset-paged per tenant and filtered by action,
    actor and date.
  - Procedure `activity.list` with permission `core.activity.read` (admin, owner).
  - Page `/settings/audit` with a `DataTable` and actor names resolved in one query.
  - Every wiremap action is declared in `*.actions.ts`.
- [x] `WM3.9` **Access overview.** `/settings/access` is a matrix of projects × members and teams
  showing the effective project role. It comes after `WM4.5`.
  - done: 2026-10-03. Gated on a new org-scoped key, `project.access.overview` (owner, admin;
    migration `0007`), since a module gate cannot be goal-scoped.
- [x] `WM3.10` Specs for each use-case. Docs: `application/docs/reference/member.md`,
  done: 2026-10-03. Docs: `packages/application/docs/reference/organization-access.md`. Integration spec `infrastructure/tests/member/pg-wiremap-access.spec.ts`.
  `organization.md` and `team.md`.

### Phase 4 — Projects and repositories

- [x] `WM4.1` **GitHub App gateway** (`application/src/port/repository.provider.ts`,
  `infrastructure/src/github/github-app.provider.ts`).
  - It mints the App JWT (RS256, `node:crypto`) and a one-repository read-only installation token.
  - It lists installation repositories, gets the default branch and branches, and fetches a file
    at a ref.
  - It dispatches a workflow.
  - It verifies `X-Hub-Signature-256`.
  - All of this is plain `fetch`, with no Octokit.
- [x] `WM4.2` **Installations.**
  - `github_installations` (org, `installation_id`, account login, `suspended_at`).
  - The install link is `https://github.com/apps/<slug>/installations/new?state=<signed org id>`.
  - The callback route `/api/github/setup` binds the installation to the org.
  - The App manifest and permissions (contents read, metadata read, push events) are in
    `docs/infra/github-app.md`.
- [x] `WM4.3` **Webhook route** `/api/github/webhook`.
  - It reads the raw body and verifies the signature.
  - It handles `push`, `installation`, `installation_repositories` and `repository` (renamed or
    deleted).
  - A push to a tracked branch enqueues a scan, deduplicated by `(repo, sha)`.
  - done: 2026-10-03. Installation and repository events apply now. A push is acknowledged and
    ignored until scans exist; `WM6.5` turns it into a scan.
- [x] `WM4.4` **Projects.**
  - `projects` (org, slug, name, description, `visibility`, `default_role`, `schedule`
    (`off|daily|weekly`), `ignore` text[], `settings` jsonb holding `tsconfigPath` and
    `workspace`, `deleted_at`).
  - `project_repositories` (org, project, provider `github|upload`, `external_id`, `full_name`,
    `branches` text[], `default_branch`, `root_path`, `private`).
  - Procedures `project.list`, `project.get`, `project.create`, `project.update`,
    `project.remove`, `repository.available` (from the installation), `repository.add`,
    `repository.update` and `repository.remove`.
  - Routes: `/projects` (list and empty state), `/projects/new` (pick repos, branches, ignores),
    `/p/$project/settings`.
  - Default ignores: `node_modules`, `dist`, `build`, `.next`, `.output`, `vendor` and
    `coverage`.
- [x] `WM4.5` **Per-project access (goal scope).**
  - Project keys:
    - `project.graph.read`
    - `project.scan.run`
    - `project.settings.manage`
    - `project.comment.write`
    - `project.ask.use`
    - `project.access.manage`
  - `project_grants` (org, project, user or team, role). Exactly one grantee, as two partial
    unique indexes.
  - `pg-capability.repository.ts` resolves goal entries from three sources: org projects (the
    default role for every member), user grants, and team grants. The highest grant wins.
  - The project's Access tab lists who has access and why (role, team or org default).
  - Specs: the goal-scope matrix (owner, admin, member, viewer × org or restricted × direct or team
    grant), plus a query count.
  - done: 2026-10-03. The keys that exist today are `graph.read`, `settings.manage`,
    `access.manage` and `delete`; `scan.run`, `comment.write` and `ask.use` arrive with the
    procedures that assert them (§28), so editor and viewer hold the same keys until `WM6`.
- [x] `WM4.6` **Delete a project's data.** `project.remove` soft-deletes it, then a maintenance job
  deletes its storage prefix, scans, comments, grants and views. An audit row is kept.
- [x] `WM4.7` Specs and docs: `application/docs/reference/project.md` and `docs/infra/github-app.md`.

**Exit.** Install the App on a test account, create a project from two repos, and restrict it:
- a member without a grant gets `NOT_FOUND`;
- a team grant opens it.

### Phase 5 — Graph format and analyzer

- [x] `WM5.1` **`GraphDocument` v1** (`contracts/src/graph/`) holds:
  - `meta`: repos, commits, branches, analyzer version and timings;
  - `languages`, `frameworks` and `files` (path, repo, language, role, loc, exports);
  - `edges` (from, to, kind, `certain`, and the specifier for unresolved ones);
  - `unresolved` and `coverage` (`resolved`, `total`, and between files of this repo);
  - `routes` (method, path, file, line, framework, guards, source `static|openapi|artisan`);
  - `calls` (file, line, method, url pattern, matched route);
  - `insights`.

  Docs: `packages/contracts/docs/reference/graph.md`.
- [x] `WM5.2` **`@loadbearing/graph`.** It is isomorphic, sits between `contracts` and
  `application` in the layering diagram, and has no dependencies besides `contracts`. `GraphIndex`
  provides:
  - adjacency both ways;
  - `dependents` and `dependencies`, transitive with a depth;
  - `impact(path)`;
  - cycles (Tarjan, components with more than one node or a self-edge);
  - `mostDepended(n)`, and unused files and exports given entry points;
  - folder aggregation at a depth (edge counts, in and out);
  - `diff(a, b)`: files, edges and routes added or removed, and new cycles.

  It is linear in nodes plus edges, with specs and a 20,000-file benchmark. Update
  `layering.md`, `docs/opinions/folders.md` and the Biome server-only list.
  - done: 2026-10-03. `cycles()` is iterative Tarjan; the 20,000-file benchmark runs in about
    300 ms against a 3 s budget.
- [x] `WM5.3` **`@loadbearing/analyzer` core.**
  - `Analyzer.run(root, options)`, with a `LanguageParser` seam and a `FrameworkPlugin` seam.
  - Detection from `package.json`, `composer.json` and file extensions.
  - Ignore globs plus `.gitignore`.
  - Workspaces: pnpm, npm and yarn workspaces, and composer path repos.
  - The output passes `GraphDocument.parse`.
- [x] `WM5.4` **TypeScript and JavaScript parser** (ts-morph).
  - Imports, re-exports, dynamic `import()` with a literal, and `require`.
  - Resolution through the tsconfig (`paths`, `baseUrl`, project references, the
    `settings.tsconfigPath` override) and workspace package names.
  - Exports per file. Coverage counts.
  - done: 2026-10-03. **Deviation:** the TypeScript compiler API directly (`createSourceFile`,
    `resolveModuleName`), not ts-morph, which wraps the same calls and needs no program here.
- [x] `WM5.5` **PHP parser** (`web-tree-sitter` + `tree-sitter-php` WASM).
  - `use` and `require`/`include` statements, resolved through the PSR-4 map in `composer.json`.
  - Classes and their methods as exports.
- [x] `WM5.6` **Role classification.** Path and name rules, plus plugin signals such as decorators
  and base classes. The roles are:
  - controller, resolver, gateway, service, repository, entity, dto, module;
  - guard, interceptor, pipe, filter, middleware, model;
  - page, layout, route, api, component, hook;
  - job, event, policy, request, migration, view;
  - utility, test, types, config, source.

  The role list shown is per framework, as in the screenshot.
- [x] `WM5.7` **Plugins.**
  - **Next.js:** `app/**/page|route`, `pages/**` and `pages/api/**`, with methods from route
    exports, and `middleware.ts`.
  - **TanStack Start:** `createFileRoute` paths and `server.handlers`, and `createServerFn`.
  - **NestJS:** `@Controller` and the method decorators give routes with joined prefixes.
    Constructor injection gives `inject` edges. `@UseGuards` gives guards, and module
    `imports`/`providers` give edges.
  - **Laravel:** `routes/*.php` (`Route::get` and the rest, `group` with prefix and middleware,
    `resource`), plus controller links.
  - **Ground truth:** an `openapi.{json,yaml}` found in the repo replaces the static routes it
    covers. With `--artisan`, `php artisan route:list --json` does the same.
  - done: 2026-10-03. Nest also reads `consumer.apply(X).forRoutes(...)` as guards, which is how
    nestjs-realworld authenticates. OpenAPI routes in a repository with no framework are `other`.
- [x] `WM5.8` **Frontend → backend matching.**
  - Calls: `fetch`, `axios`, `ky` and `ofetch`, with literal or template URLs normalised to
    `/a/:param`.
  - Each call is matched against every route in the project, across repos.
  - An exact match is `certain`, and a template or prefix-only match is not.
- [x] `WM5.9` **Insights at scan time:**
  - most depended-on;
  - cycles;
  - unused files and exports (entry points come from plugins and `package.json`);
  - routes without a guard or auth middleware (per framework: Nest guards, Laravel `auth*`
    middleware, Next middleware matchers).
- [x] `WM5.10` **Fixtures and specs.**
  - `packages/analyzer/tests/fixture/` holds a small NestJS app (shaped like nestjs-realworld), a
    Next.js app, a TanStack Start app, a Laravel app and a pnpm monorepo.
  - Golden `GraphDocument` snapshots.
  - Each plugin's routes, with file and line, are asserted.
- [x] `WM5.11` **`apps/cli`** (`wiremap`, bin), with commander-free argument parsing.
  - `wiremap analyze [dir] --out graph.json` works with no account.
  - Bundled with tsup into one ESM file. The WASM grammars are copied next to it.

  - done: 2026-10-03. The workspace package is `@loadbearing/cli` with the bin `wiremap`: the
    root already holds the name. The npm name is chosen at publish (`WM11.2`).
**Exit.** `wiremap analyze` on a clone of `lujakob/nestjs-realworld-example-app` reports 21 routes
and a coverage line like the screenshot's, and every fixture snapshot passes.

### Phase 6 — Scans

- [x] `WM6.1` **`scans`.**
  - Columns: org, project, trigger, state, branch, commit sha, `requested_by`, `queued_at`,
    `started_at`, `finished_at`, error, `graph_key`, `graph_bytes`, `counts` jsonb (files,
    imports, resolved, routes, cycles, unguarded), `analyzer_version`.
  - `PARTITION BY LIST (organization_id)`, then `RANGE (queued_at)`.
  - `scan_findings` (org, project, scan, kind, key, first seen).
  - done: 2026-10-03. `created_at` is the queue time and the month key, since the partition
    registry's column union has no `queued_at`. Findings are a project's open set, not a history.
- [x] `WM6.2` **`ScanRunner` port**, with two adapters:
  - `GithubActionsScanRunner` dispatches `.github/workflows/scan.yml` in `WIREMAP_RUNNER_REPO`
    using `WIREMAP_RUNNER_TOKEN`.
  - `LocalScanRunner` spawns `node apps/cli/dist/index.js runner` in development.
- [x] `WM6.3` **Runner protocol.** These endpoints are under `/api/scan/$id/`. They authenticate
  with a scan token (HMAC of scan id and expiry, 1 hour), are single-use where it matters, and
  check the scan state.
  - `checkout` returns the repos, refs, ignore and settings, and a read-only installation token
    per repo.
  - `upload` returns a presigned PUT.
  - `complete` takes the counts. The server reads the graph back and validates it against the
    schema and a size cap of 25 MB gzipped.
  - `fail` takes an error.
  - done: 2026-10-03. **Deviation:** the token is an HMAC of the scan reference under a secret
    the workflow also holds, with no expiry in it. The scan's state is the gate, and the sweep ends any run at 30 minutes.
- [x] `WM6.4` **`scan.yml` and the `runner` command.**
  - Checkout of each repo, `--depth 1`, with `::add-mask::` on tokens.
  - Analyze, gzip, upload and complete. On any failure it calls `fail`.
  - The workflow logs no paths from the target repository.
  - A timeout of 20 minutes.
- [x] `WM6.5` **Triggers.**
  - Manual is `scan.run`, deduplicated while one is queued or running.
  - Push comes from `WM4.3`.
  - Schedule: the hourly dispatcher tick runs `ScheduleScansUseCase` for projects that are due.
  - A stuck scan (running for more than 30 minutes) is failed by the hourly tick.
  - done: 2026-10-03. Push dedupe is one queued or running scan per project, not `(repo, sha)`.
- [x] `WM6.6` **Upload path.**
  - `scan.createUpload` (API key, `project.scan.run`) returns a presigned PUT and a scan token.
  - `wiremap upload graph.json --project <slug>` and `wiremap scan` (analyze and upload).
  - Source never leaves the machine.
  - done: 2026-10-03. Verified end to end against the local stack. Fixed on the way: an API key
    could not carry a project scope, because `can` on a goal key with no goal is false.
- [x] `WM6.7` **Completion.**
  - It saves counts and findings, diffing against the last succeeded scan on that branch.
  - It emits `scan.succeeded` or `scan.failed`, and `finding.created` per new cycle or unguarded
    route, through the outbox.
- [x] `WM6.8` **History UI.**
  - `/p/$project/scans` is a `DataTable` of state, trigger, branch, commit, duration and error.
  - A "Scan now" button sits behind `<Can>`.
  - A running row polls (`WM1.6`).
- [x] `WM6.9` **Graph read.** `graph.get(projectId, scanId?)` checks access, then returns a
  presigned GET of the gzipped file with a 5-minute TTL. The browser fetches and caches it by scan
  id, and it is immutable.
- [x] `WM6.10` Specs (state machine, token, dedup, diff → findings) and docs:
  `application/docs/reference/scan.md`.

**Exit.** A push to a connected repo produces a succeeded scan on GitHub Actions within a few
minutes. A broken tsconfig produces a failed scan with its error shown.

### Phase 7 — Graph explorer

- [x] `WM7.1` **Libraries.** `@xyflow/react` and `elkjs` go in the catalog, React tier, in
  `feature` only. ELK runs in a web worker (`elk-worker`). Docs: `docs/opinions/dependencies.md`
  row.
  - done: 2026-10-03. ELK runs in a classic worker the app creates (`elk-worker.min.js?url`);
    `feature` takes a `GraphLayouter` and shows a grid until it answers.
- [x] `WM7.2` **Page `/p/$project`** as three panes:
  - the role sidebar;
  - the canvas;
  - a tabbed right panel (Overview | Ask).

  The whole page fills the viewport under the shell, and the panes are resizable.
- [x] `WM7.3` **Canvas.**
  - Folder group nodes at depth 2 by default, showing `name`, `n files · in x · out y` and a
    badge.
  - Expanding one shows its files with role dots and in/out counts, as in the screenshot.
  - Edges are aggregated between folders and drawn per file when expanded.
  - `inject` and `api` edges are styled apart. An uncertain edge is dashed.
  - Zoom, pan and fit, with a minimap.
- [x] `WM7.4` **Role sidebar.**
  - "<Framework> files by role" with dots and counts.
  - Clicking a role dims everything else. Clicking it again clears. The hint text sits at the
    foot.
  - Filters by folder and by framework sit in the same panel.
- [x] `WM7.5` **Partial-graph banner**: "Graph is partial: X of Y imports into this repository
  resolved (P%)". Expanding it lists the unresolved specifiers.
- [x] `WM7.6` **Node detail.** Clicking a file or folder opens it in the right panel: role,
  imports, dependents, routes defined, comments count and "Show impact".
- [x] `WM7.7` **Overview tab:**
  - repo name, framework, files, imports (and how many are between files here), routes;
  - a routes table (method, path, `file:line`) with "Show all N";
  - "Most depended on", by files importing it.
- [x] `WM7.8` **Search.** Ctrl/Cmd-K (`CommandDialog`) over files, exported classes and routes.
  Following a result centres and selects the node.
- [x] `WM7.9` **Saved views and links.**
  - View state (filters, expanded folders, selection, viewport) lives in the URL search params,
    so any URL is shareable.
  - `graph_views` (org, project, name, state, `created_by`) with `view.list`, `view.save` and
    `view.remove`.
  - A branch picker and a scan picker.
  - done: 2026-10-03. The viewport is not in the URL: the selection is, and it is centred on
    load. The scan picker labels each scan with its branch, which covers the branch picker.
- [x] `WM7.10` **Performance.**
  - Aggregation runs in the worker.
  - Only visible nodes are rendered (React Flow `onlyRenderVisibleElements`).
  - Budget: a 5,000-file graph is interactive in under 2 s, and pan stays at 60 fps on the dev
    machine.
  - A generated fixture backs the benchmark spec.
  - done: 2026-10-03. **Deviation:** the view model runs on the main thread. It builds a
    5,000-file view in tens of milliseconds (`explorer.spec.ts` allows one second), so only ELK earns the worker.
- [x] `WM7.11` Specs (aggregation, dimming, URL state round trip) and docs:
  `packages/feature/docs/reference/graph.md`.

**Exit.** The explorer next to the screenshot, on the nestjs-realworld scan in `wiremap` dark, is
the same layout.

### Phase 8 — Insights

- [x] `WM8.1` **Insights tab** `/p/$project/insights`, with sections that each link into the graph:
  - most depended-on;
  - cycles, each one drawn;
  - unused files and exports;
  - unguarded routes.
- [x] `WM8.2` **Change impact.** Pick a file to highlight its transitive dependents by depth, list
  them, and list the routes whose handler files are affected.
- [x] `WM8.3` **Compare.**
  - `/p/$project/compare?a=&b=` across two scans or two branches' latest scans.
  - Files, edges and routes added or removed, and cycles introduced or fixed.
  - The diff is computed in the browser with `GraphIndex.diff`.
- [x] `WM8.4` Specs and docs.

### Phase 9 — Ask

- [x] `WM9.1` **`SecretCipher` port**, with `NodeAesGcmSecretCipher` (key from
  `SECRET_ENCRYPTION_KEY`, a versioned key id for rotation). Specs.
- [x] `WM9.2` **AI settings.**
  - `organization_ai` (org, enabled, provider `gemini|none`, encrypted key, model).
  - Procedures `ai.settings` and `ai.updateSettings` (owner, admin). The key is write-only and
    shows as `••••last4`. A "Test key" button.
- [x] `WM9.3` **`ChatProvider` port**, with `GeminiChatProvider`.
  - REST `streamGenerateContent` over `fetch`, with a model default of `gemini-2.5-flash`.
  - Streamed as an oRPC event iterator.
  - Errors are mapped to the kit's codes.
- [x] `WM9.4` **Grounding** (`AskProjectUseCase`).
  - It retrieves from the graph: file and route matches by name, the neighbourhood of the
    mentioned files, and the overview counts.
  - Contents of up to 8 files are fetched live through the GitHub App at the scan's commit. They
    are not stored, are cached in Redis for 10 minutes, and are capped by size.
  - The answer must cite `path:line` or `METHOD /path`. Citations render as links that select the
    node.
  - done: 2026-10-03. Retrieval is by name (paths, file names, exports), not embeddings: names
    are what people ask about, and it costs no second model call.
- [x] `WM9.5` **Ask tab.**
  - A thread for the session, with a stop button.
  - Presets: "Explain this file / module / route" (from node detail) and "Onboarding summary".
    The onboarding summary is cached per scan, in Postgres, on `scans.summary`.
- [x] `WM9.6` **Limits.**
  - `RateLimitPolicy` allows 20 questions per user per hour and 200 per org per day.
  - Answers are cached by (scan, normalised question) for 1 hour.
  - Ask is hidden when AI is off.
- [x] `WM9.7` Specs (fake provider, citation parsing, no-key path) and docs:
  `application/docs/reference/ask.md`.

### Phase 10 — Collaboration and notifications

- [x] `WM10.1` **Comments.**
  - `comments`: org, project, target kind `file|folder|route|node`, target key, body (Markdown,
    sanitised), author, parent (one level of threads), `resolved_at`, `pinned`, edited and deleted
    timestamps.
  - Partitioned LIST by org.
  - Procedures `comment.list`, `comment.create`, `comment.update`, `comment.remove`,
    `comment.resolve` and `comment.pin`.
  - Comment counts show on nodes, and the thread shows in node detail.
  - done: 2026-10-03. Target kinds are `file|folder|route|project`. The body is plain text,
    rendered as text, not sanitised Markdown: a sanitiser is a second parser to keep in step
    forever. A node's count also rolls up to every folder above it.
- [x] `WM10.2` **Mentions.**
  - The `@` picker searches project members. Stored as `@[userId]`, rendered as a name.
  - A mention notifies, but only members who can read the project.
  - done: 2026-10-03. The picker offers the organization's first 100 active members. Delivery
    drops anyone `NotificationAccess.readsProject` refuses, so the picker need not be exact.
- [x] `WM10.3` **Pinned notes.** A pinned comment is a note. Notes show as a pin on the node and in
  an "Notes" list in Overview.
- [x] `WM10.4` **Project activity feed.**
  - `/p/$project/activity` reads `activity_log` through `ActivityReader` with
    `payload->>'projectId'`, backed by an expression index (org, project id, `occurred_at`).
  - It shows scans, settings changes, comments and access changes.
  - done: 2026-10-03. Procedure `activity.project` on `project.graph.read`, not the audit
    log's `audit.log.read`. Notification links go through `/go/project/$projectId`.
- [x] `WM10.5` **Notification policies:**
  - `scan.failed` goes to the project's admins and whoever requested the scan;
  - `finding.created` goes to project admins, as a digest when there are more than 5;
  - `comment.mentioned`, and `comment.replied` to the thread author;
  - invitations already exist.

  Each one gets email and in-app. Categories are added to preferences, and copy is written.

  done: 2026-10-03. One `comment.created` event covers mentions and replies. "Project admins"
  is the org-wide holders of `project.access.overview` (owner, admin): the recipient reader
  resolves org grants, not goal grants. `finding.created` is always a digest.

### Phase 11 — Integrations

- [ ] `WM11.1` **Public API.**
  - Mount oRPC's `OpenAPIHandler` at `/api/v1`, with API-key bearer auth, over a read-only subset:
    projects, scans, graph (presigned URL), routes, insights and impact.
  - The spec is served at `/api/v1/openapi.json`, with a docs page.
  - Rate limited per key.
- [ ] `WM11.2` **CLI, publish-ready.** `wiremap login` (stores an API key in the user config dir),
  `analyze`, `upload`, `scan` and `mcp`. README, plus an npm `files` allowlist. Publishing is owed
  to the owner.
- [ ] `WM11.3` **GitHub Action** `apps/action/action.yml`, a composite action. It runs `npx wiremap
  scan` with `api-key` and `project` inputs. An example workflow goes in the docs.
- [ ] `WM11.4` **MCP server** `wiremap mcp` (`@modelcontextprotocol/sdk`, stdio).
  - Tools: `overview`, `find_files`, `dependents`, `dependencies`, `impact`, `routes`,
    `route_for_path` and `cycles`.
  - The source is a local `graph.json` or the remote API. Setup snippets for Claude Code and
    Cursor.
- [ ] `WM11.5` **VS Code extension** `apps/vscode`.
  - A "Wiremap" view: for the active file it shows role, imports, dependents and routes.
  - "Show impact" and "Open in wiremap" commands.
  - It reads a local `graph.json` or the API with a key in SecretStorage.
  - Built with esbuild and packaged with `vsce package`. Marketplace publishing is owed to the
    owner.
- [ ] `WM11.6` **Outgoing webhooks and Slack.**
  - `webhooks` (org, project nullable, kind `generic|slack`, URL, encrypted secret, events[],
    `disabled_at`, `failure_count`).
  - Delivery is a `QueueName.WEBHOOK` job with an HMAC header (`X-Wiremap-Signature`), 8
    attempts, and auto-disable after 20 failures in a row.
  - Slack messages use Block Kit formatting for `scan.succeeded`, `scan.failed` and
    `finding.created`.
  - Page `/settings/webhooks`, with "Send test".
- [ ] `WM11.7` Specs and docs: `docs/integrations/index.md`, one page each.

### Phase 12 — Security, privacy and wrap-up

- [ ] `WM12.1` **Security review.**
  - Tokens are never stored: grep shows no installation token persisted.
  - Secrets are encrypted (`SecretCipher` covers Gemini keys and webhook secrets), and graphs use
    SSE-B2.
  - Read-only App permissions.
  - Scan tokens are single-scope.
  - The webhook signature is checked in constant time.
  - Run `/security-review`.
- [ ] `WM12.2` **Deletion.** Project delete (`WM4.6`) and org delete (`WM3.2`) remove storage
  prefixes. A spec proves no object or row is left except the audit trail.
- [ ] `WM12.3` **Privacy page** `/privacy`: what is stored (graph, metadata), what is not (source),
  and local CLI analysis.
- [ ] `WM12.4` **`TESTS.md`** rows for every phase: what was run, and what is owed by hand (real
  GitHub App, B2, Neon, Upstash, Vercel and Cloudflare deploys, Gemini key, Slack).
- [ ] `WM12.5` **The full gate.** Typecheck, lint, every test, `check:architecture`,
  `check:contrast`, the dispatcher dry run, then push with CI green. Update `HANDOFF.md` and
  `docs/plans/index.md`.

---

## Verification — the whole plan

```bash
pnpm build:packages && pnpm --filter @loadbearing/web build
pnpm -r --no-bail run typecheck && pnpm lint
pnpm -r --no-bail run test        # stack up: pnpm infra:up, db:migrate, db:seed
CI= node tooling/scripts/check-architecture.mjs && pnpm check:contrast
pnpm --filter @loadbearing/dispatcher exec wrangler deploy --dry-run
node apps/cli/dist/index.js analyze <nestjs-realworld clone> --out /tmp/g.json
```

By hand, locally (`QUEUE_DRIVER=cloudflare`, `wrangler dev`, `SCAN_RUNNER=local`, Mailpit):
- **Orgs:** create, switch, rename, transfer ownership, delete. Invite by email and by link,
  resend, revoke. Domain auto-join. Remove a member. Teams. Audit page shows each action.
- **Access:** an org project and a restricted one, against owner, admin, member, viewer, a direct
  grant and a team grant.
- **Scans:** manual, upload from the CLI, and a schedule tick through the dispatcher. A failure
  shows its error. The history table is correct.
- **Explorer:** each item in Phase 7 against the screenshot, and the 5,000-file fixture.
- **Insights, compare, Ask** with a real Gemini key, plus the no-key path. **Comments,** mentions
  and notes. **Notifications:** in-app by polling and in Mailpit.
- **Integrations:** the API through the OpenAPI spec, the MCP server from Claude Code, the VS Code
  extension from a `.vsix`, and a webhook to a request bin.

Owed by the owner, with real accounts (`TESTS.md`): GitHub App registration, deploys to Vercel and
Cloudflare, Neon, Upstash and B2 credentials, a push-triggered scan on Actions, and Slack.

## Not in this plan

- Billing, plans for sale, and the usage dashboard (Polar, Paddle or Lemon Squeezy, and Vercel Pro).
- GitLab and Bitbucket (`RepositoryProvider` is the seam).
- SAML SSO (Better Auth `sso` plugin later).
- Python, Go and Java parsers, and Express and FastAPI plugins (`LanguageParser` and
  `FrameworkPlugin` are the seams).
- Push realtime (`docs/scale/realtime.md`).
- Publishing the CLI to npm and the extension to the Marketplace (owner accounts).

## Changelog

| Date | Who | Change |
|---|---|---|
| 2026-10-03 | @sami | Plan written from the feature list, the stack, the screenshot and two rounds of questions. |
