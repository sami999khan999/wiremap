# wiremap

**See how a codebase is wired.** Wiremap scans a team's repositories and draws the import graph
grouped by folder, classifies every file by role, lists the routes a backend exposes and the
frontend calls that reach them, and points at what needs attention: cycles, unused files, routes
with no auth guard. An "Ask" assistant answers questions grounded in that graph.

TanStack Start + oRPC on Vercel · Cloudflare Queues and Cron as the scheduler · Neon Postgres ·
Upstash Redis · Backblaze B2 · Better Auth · GitHub App + GitHub Actions as the scan runner ·
ts-morph and tree-sitter · React Flow with ELK · Gemini (each organization's own key)

**Built on the loadbearing lite kit.** Same packages, same `@loadbearing/*` scope, same rules, so a
kit fix ports across as a file copy. [`UPSTREAM.md`](UPSTREAM.md) records the kit commit, and
[`docs/plans/WIREMAP-PLAN.md`](docs/plans/WIREMAP-PLAN.md) is the live plan.

## Run it yourself

One container holds everything (Postgres, Redis, storage, mail, the app and the worker):

```bash
docker run -d --name wiremap -p 127.0.0.1:43000:43000 -p 127.0.0.1:48025:48025 -v wiremap-data:/data prodigycorp/wiremap
```

Then open `http://localhost:43000`, sign up, and create the GitHub App from **Platform → GitHub**.
The first steps, backups, upgrades and the compose alternative are in
[`docs/infra/self-hosted.md`](docs/infra/self-hosted.md). How the image is released is
[`docs/infra/publishing.md`](docs/infra/publishing.md). Wiremap is licensed under the
[AGPL-3.0](LICENSE).

## Running it locally

Node ≥ 24, pnpm ≥ 11.21, Docker running.

**1 · Install and configure.** Copy the template whole — every required key has a working local
value in it, and `apps/web/src/env.ts` parses the entire schema at module load, so a missing one is
a boot failure rather than a 500 an hour later.

    pnpm install
    node -e "require('fs').copyFileSync('.env.example', '.env')"

**2 · Host ports, if any are taken.** Every published port is the well-known one with a `4` in
front — Postgres on `45432`, Redis on `46379` — so this stack does not fight another one on your
machine for `5432`. Inside the compose network nothing moved: `postgres:5432` is still `postgres:5432`.

There is **one env file**, the `.env` at the root, and both halves of a port live in it — the
`*_PORT` that compose publishes and the URL that dials it. Change both together:

    POSTGRES_PORT=45432
    DATABASE_URL=postgres://ratchet:ratchet@localhost:45432/ratchet

`POSTGRES_PORT` `REDIS_PORT` `S3_PORT` `MINIO_CONSOLE_PORT` `SMTP_PORT` `MAILPIT_UI_PORT` and
`WEB_PORT` are the full set, each documented in `.env.example`.
`check:architecture` §27 fails the build if a `*_PORT` and the URL beside it ever disagree, which
is the failure that otherwise reads as a connection refused and names nothing.

For the web app, `WEB_PORT` is the one to change: `apps/web/vite.config.ts` reads it, and
`APP_BASE_URL`, `AUTH_URL` and `AUTH_TRUSTED_ORIGINS` must all name it — Better Auth signs cookies
against the second and the CORS layer reads the third. §27 checks all three.

**3 · Infrastructure.** Five containers: Postgres + pgvector, one Redis (`noeviction`, because it
holds the queue as well as the cache), MinIO with its one-shot bucket init, and Mailpit. See
[docs/setup/11](docs/setup/11-local-infrastructure.md).

    pnpm infra:up
    node tooling/scripts/compose.mjs ps   # all healthy before continuing

Also set a real `AUTH_SECRET` in `.env` (`openssl rand -hex 32`): the template's `change-me` is too
short for the web app's schema. Search needs no key by default: `EMBEDDING_PROVIDER=none` is
Postgres full-text search, and `openai` or `gemini` switch it to embeddings —
[reference/embedding](packages/infrastructure/docs/reference/embedding.md).

**4 · Database.**

    pnpm db:migrate        # drizzle migrations — including Better Auth's own tables
    pnpm db:seed           # the `loadbearing` organization + the four system roles

`db:seed` prints `seed complete: <organizationId>`. It creates no user — the first person to sign up
is enrolled into that organization. (`pnpm auth:tables` creates nothing: it prints what Better
Auth's tables must look like in the pinned runtime, to diff against `auth.schema.ts` after an
upgrade.)

**5 · Run.** `pnpm dev` builds the packages first, then runs web and worker in parallel; both load
the root `.env` themselves.

    pnpm dev               # or: pnpm dev:web

| | |
|---|---|
| Web app | http://localhost:43000 |
| Mailpit — catches every outgoing mail | http://localhost:48025 |
| MinIO console | http://localhost:49001 |
| Readiness probe | http://localhost:43000/api/health |
| Drizzle Studio | `pnpm db:studio` |

**6 · First sign-in.** Sign up at `/sign-up`. `AUTH_REQUIRE_EMAIL_VERIFICATION` defaults to on, so
the verification mail lands in Mailpit — open it and click through.

> Every message in this system is a job on `QueueName.MAIL`, rendered and sent by the worker, so
> **nothing reaches Mailpit unless the worker is running**. `pnpm dev` starts both. What that buys
> is one send path with retries, backoff and a rate limiter behind it — the argument is in
> [`packages/composition/docs/reference/mail-pipeline.md`](packages/composition/docs/reference/mail-pipeline.md).

**No session is ever issued without a membership**, so how you acquire one is a decision the
template makes for you: `AUTH_ENROLMENT_MODE=personal` ships as the default, which makes you the
`owner` of an organization of your own with the same four system roles `pnpm db:seed` creates. It is
the only mode that works against an empty database. The other two are `bootstrap` (everyone joins
the one organization `BOOTSTRAP_ORGANIZATION_SLUG` names, first in as `owner`) and `invite` (an
invitation is the only door — the production posture). Whichever mode is set, an address with a
pending invitation joins the organization that invited it instead.

`owner` holds `rbac.role.read`, so `/settings/roles` renders. Invite a second address from
`/settings/members`, accept it in another browser profile, and that `member` account is redirected
to `/forbidden` — the fastest way to watch both the route guard and the use-case gate work on the
same decision.

**Before committing.**

    pnpm check:architecture   # needs pnpm build:packages + a web build, or two assertions skip
    pnpm typecheck && pnpm lint && pnpm test

### When it does not come up

| Symptom | Cause |
|---|---|
| 500 on first request, a `ZodError` naming env keys | `.env` missing or incomplete — redo step 1 |
| `/api/health` returns 503 | a container is not up, or a URL in `.env` names the wrong host port |
| `ECONNREFUSED` from `db:migrate` | Postgres not healthy yet, or something else holds 5432 |
| Signed up, but the shell still renders signed-out | no membership: under `bootstrap`, `BOOTSTRAP_ORGANIZATION_SLUG` is unset or `db:seed` never ran; under `invite`, there is no invitation for the address |

**What lite leaves out, and keeps ready.** No pgBouncer, replica, second Redis, ClickHouse, Loki,
cold tier or extra shard node runs here, and messaging, widgets and the analytics screens are not
built. The seams under them stay: every table is partitioned by tenant, every repository declares
its shard placement, and `DATABASE_URL` is written as if a pooler sat in front. *The seam being
built* and *the store being started* are separate decisions, and only the second costs anything to
be wrong about. Each store comes back by its page in [`docs/scale/`](docs/scale/index.md).

## Documentation

- **[`AGENTS.md`](AGENTS.md)** — what a coding agent reads first, and the only file most tools load
  unprompted. A brief and nothing else: four rules that cost the most when broken, then a pointer
  to the task router. `CLAUDE.md` `@`-imports it rather than restating it.
- **[`docs/ai/`](docs/ai/index.md)** — everything written for agents rather than for people. This
  page is the task router, one row per thing you might be about to do.
  [`rules/`](docs/ai/rules/index.md) is the rulebook, one file per topic and none over ~900 tokens;
  [`skills/`](docs/ai/skills/add-slice.md) holds the run books, surfaced in Claude Code through
  `.claude/skills/`.
- **[`docs/setup/`](docs/setup/00-README.md)** — the build order, walked once. Thirty-one documents
  from an empty directory to a running app: `01`–`27` build the kit (`09b` included), `28` and `29`
  are reference, and `30` adds the desktop shell.
- **[`docs/opinions/`](docs/opinions/index.md)** — the reference, consulted continually. Every rule
  for what to call a thing, where to put it, and which store owns it.
- **`packages/*/docs/`** — one reference set per package: what it is for, and why each export is
  shaped the way it is.
- **[`docs/infra/`](docs/infra/index.md)** — the running stack: what each container is for, and what
  to check when it is wrong.
- **[`docs/scale/`](docs/scale/index.md)** — what lite removed, when a project needs each piece back,
  and how to port it from the big kit. [`back-ports.md`](docs/scale/back-ports.md) lists what lite
  added that the big kit still owes.
- **[`docs/plans/`](docs/plans/index.md)** — the live plan, the handoff, and the test runs still owed.
