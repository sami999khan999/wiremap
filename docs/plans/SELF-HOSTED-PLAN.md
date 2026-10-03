---
title: Self-hosted plan — wiremap in one Docker container on your own machine
updated: 2026-10-03
owner: sami
schema: plan/v1
source: owner request 2026-10-03 ("run it locally within a docker container… everything in one docker image… still be able to connect the github repo"), after the free-tier deploy stopped on Cloudflare's per-account cron limit
---

# Self-hosted plan

> **How to use this file**
> 1. The ID prefix is `SH`, which no other plan uses. Items are `SH<phase>.<n>`.
> 2. Checkboxes: `[ ]` todo, `[~]` in progress, `[!]` blocked, `[x]` done, `[-]` dropped. Add
>    `done: YYYY-MM-DD` when closing an item.
> 3. Phases run in order. Each item names the doc it updates.
> 4. Commit once per layer, using conventional commits with a scope. **No AI or co-author
>    trailers.** `docs/ai/rules/workflow.md` outranks any tool default.
> 5. Run `pnpm check:architecture` before calling an item done. Push at the end of each phase.

---

## Context

The free-tier deploy (`WIREMAP-PLAN.md`, decisions 3–9) got as far as Neon, a Vercel project and
the Cloudflare Worker and queues. It stopped on two things:
- The Cloudflare account has used all five free cron triggers on other Workers, so wiremap's
  hourly tick cannot be created.
- Upstash, B2 and SMTP need accounts no tool here is signed in to.

The owner chose a different shape: **everything in one Docker image, started with one
command, on their own machine, still connected to GitHub.**

That shape removes both blockers.
- **No cron trigger is needed.** `apps/worker` runs BullMQ, and its repeatable jobs are the
  schedule: the outbox drain, the hourly scan tick, nightly maintenance and the morning digest.
- **No vendor accounts are needed.** Postgres, Redis, MinIO and Mailpit run inside the
  container. The only outside service is GitHub.

**What stays as built.** Every port and adapter is unchanged. `QUEUE_DRIVER=bullmq`,
`SCAN_RUNNER=local` and `REALTIME_DRIVER=none` already exist. The free-tier path stays in the
repository and still works. This plan adds a deployment; it rewrites no feature.

### Decisions recorded up front

1. **One image, many processes, one supervisor.** The image runs Postgres (with pgvector),
   Redis, MinIO, Mailpit, the web app, the worker and, optionally, `cloudflared`. A supervisor
   (`s6-overlay`) starts them in dependency order and restarts any that die. This is not
   Docker's one-process-per-container norm, and that is acceptable for a single machine. A
   `docker compose` file with the same pieces as separate containers ships beside it
   (`SH5.1`) for anyone who prefers that shape.
2. **One port.** Only the web app is published: `43000`, the port `.env.example` already uses.
   Storage is reached through the web app (`SH1`), so no MinIO port has to be published or
   kept consistent between inside and outside the container. Mailpit's inbox (`48025`) is
   optional and off by default.
3. **Bound to loopback by default.** The documented command publishes
   `127.0.0.1:43000:43000`. `docs/infra/self-hosted.md` explains why: Docker's published ports
   bypass a host firewall.
4. **All state on one volume, `/data`.** It holds the Postgres cluster, Redis's AOF, MinIO's
   objects, generated secrets and backups. Deleting the container loses nothing, and deleting
   the volume loses everything.
5. **Secrets are generated on first start.** `AUTH_SECRET`, `INTERNAL_JOB_SECRET`,
   `SECRET_ENCRYPTION_KEY` and the database and MinIO passwords are written to
   `/data/secrets.env` (mode `0600`) on the first boot and read on every boot after. An env file
   passed with `--env-file` overrides any of them, and supplies the optional ones: SMTP, the
   GitHub App, and the tunnel.
6. **Scans run inside the container** (`SCAN_RUNNER=local`). The CLI and `git` ship in the
   image. A scan clones one commit with a one-repository read-only token, analyzes it, stores
   the graph, and deletes the clone. Source code never leaves the machine. The GitHub Actions
   runner is not used, because it would have to call back to this machine.
7. **GitHub works without a public address**, by direction:
   - **Connecting** (install, OAuth check): browser redirects to `http://localhost:43000`.
     Works.
   - **Reading** (repository lists, read tokens, file contents for Ask): outbound calls to
     `api.github.com`. Works.
   - **Push webhooks**: GitHub must reach the machine. Without a public address they do not
     arrive. Two remedies, both in this plan:
     - **Polling, on by default** (`SH4.2`): the hourly tick asks GitHub for each tracked
       branch's head and scans when it moved. Push-to-scan latency is up to an hour, at no setup
       cost.
     - **Cloudflare Tunnel, optional** (`SH4.3`): with `CLOUDFLARE_TUNNEL_TOKEN` set, the
       container gets a public hostname, webhooks arrive, and scans start within seconds.
       Cloudflare Tunnel is free and uses no cron trigger.
8. **Migrations run on every start**, before the web app and the worker. They are idempotent,
   and a new image migrates its own data. The seed runs once, on first start.
9. **Mail goes to Mailpit until SMTP is configured.** Verification is still required, and the
   message is read in Mailpit's inbox (`SH3.4`). Setting `SMTP_URL` sends real mail. For a
   single-person install, `AUTH_REQUIRE_EMAIL_VERIFICATION=false` is documented as an option.
10. **The cloud resources already created are left in place** until the owner decides
    (`SH6.4`). They cost nothing as they are.

### What exists and is reused

| Piece | Where |
|---|---|
| Support services and their versions | `infra/docker-compose.yml` (pgvector pg17, redis 7, MinIO, Mailpit) |
| Postgres init (roles, extensions) | `infra/postgres.init.sql` |
| Web entry, multi-process | `apps/web/cluster.mjs` → `apps/web/.output/server/index.mjs` |
| Worker entry | `apps/worker` (`dist/main.js`), BullMQ consumers and repeatables |
| Local scan runner | `packages/infrastructure/src/process/local.scan-runner.ts` (`SCAN_RUNNER=local`, `WIREMAP_CLI_PATH`) |
| CLI bundle | `apps/cli` (`dist/index.js` + `tree-sitter-php.wasm`) |
| Migrate, seed | `packages/infrastructure/migrate.ts`, `seed.ts` |
| Health | `GET /api/health` (database, cache, queue) |
| Presigned storage links | `GetGraphUseCase`, `CreateScanUploadUseCase`, `UploadScanUseCase`, `S3StorageGateway.presign*` |
| Self-hosted guidance | `docs/infra/self-hosted.md` |

---

## The phases

### Phase 0 — Groundwork

- [x] `SH0.1` **Plan registered.** This file goes in `docs/plans/index.md` and `meta.json`.
  `HANDOFF.md` names it as next.
  - done: 2026-10-04.
- [x] `SH0.2` **The deploy guide gap.** `SECRET_ENCRYPTION_KEY` and its version go into
  `docs/infra/deployment.md`. It was missing there, and its absence switched Ask and webhooks
  off.
  - done: 2026-10-04. A table in step 5, with the rotation and the warning to keep the key outside Vercel.
- [x] `SH0.3` **Commit the dispatcher's single cron** made during the free-tier attempt. One
  trigger whose hour decides the nightly and morning work fits the free plan's per-account
  limit, and it stays the right shape for the cloud path. Specs pass, and the README is
  updated.
  - done: 2026-10-04. 14 dispatcher specs pass.

### Phase 1 — Storage through the web app

The browser downloads graphs, and the CLI uploads them, through presigned URLs that name the
storage host. In one container that host is internal. Proxying both through the web app keeps
one port and one public hostname.

- [x] `SH1.1` **A storage access mode in the container config**: `storage.access: "presigned" |
  "proxied"`, from `S3_ACCESS=presigned|proxied` (default `presigned`, so the cloud path is
  unchanged).
  - done: 2026-10-04. `S3_ACCESS` in both apps. `proxied` without `STORAGE_URL_SECRET` stops startup; the worker issues links too and carries no auth secret, so the key is its own.
- [x] `SH1.2` **Signed app URLs.** In `proxied` mode, the gateway's `presignDownload` and
  `presignUpload` return `${APP_BASE_URL}/api/storage/<key>?exp=&sig=`, an HMAC over method, key
  and expiry with `AUTH_SECRET`. The expiry is the one the use-case already asks for, so no
  use-case changes. The adapter is `ProxiedStorageGateway`, wrapping `S3StorageGateway` in
  `infrastructure/src/s3/`.
  - done: 2026-10-04. `ProxiedStorageGateway` decorates the bucket gateway, and the container exposes it as `storageProxy`.
- [x] `SH1.3` **The route** `apps/web/src/route/api/storage/$.ts`:
  - It verifies the signature in constant time, and the method it was signed for.
  - `GET` streams the object, with `content-type` and `cache-control: private, immutable` for
    graphs.
  - `PUT` streams the body to the object, capped at 25 MB, the graph cap. Anything larger is
    refused while streaming.
  - It is never a listing, and never a key outside the one signed.
  - done: 2026-10-04. Live against MinIO through the dev server: put and get round-trip the same bytes, a tampered link and an upload link used to read are 403, a missing key is 404, 26 MB is 413 and leaves nothing.
- [x] `SH1.4` **Specs.** A signature for one key does not open another. An expired or tampered
  signature gets 403. `PUT` past the cap gets 413 and nothing is stored. A round trip of a
  real graph works. Docs: `packages/infrastructure/docs/reference/` gets a storage-access page.
  - done: 2026-10-04. Gateway spec (5), path parsing spec, and `packages/infrastructure/docs/reference/storage-access.md`.

### Phase 2 — The image

- [x] `SH2.1` **`docker/wiremap/Dockerfile`, multi-stage.**
  - *Build*: `node:24-bookworm`, pnpm from `packageManager`, `pnpm install --frozen-lockfile`,
    `pnpm build:packages`, the web build (Node preset), the worker build, the CLI bundle.
  - *Runtime*: `node:24-bookworm-slim`, plus:
    - Postgres 17 and `postgresql-17-pgvector` from the PGDG apt repository;
    - `redis-server`, `git`, `ca-certificates`;
    - MinIO, Mailpit and `cloudflared` as pinned release binaries, each with its checksum
      verified;
    - `s6-overlay`.
  - It copies only what runs: `apps/web/.output`, `apps/web/cluster.mjs`, `apps/worker/dist`,
    `apps/cli/dist`, `packages/infrastructure` (migrate, seed, migrations), and the production
    `node_modules` from `pnpm deploy`.
  - It runs as a non-root `wiremap` user. Postgres runs as `postgres`.
  - done: 2026-10-04 (amd64; arm64 is `SH2.4`). **Changed from the plan:** the worker and the database scripts are bundled into single files with esbuild instead of copied with `pnpm deploy`. `pnpm deploy --legacy` links workspace packages back to their sources, which the runtime image does not have, and a prune that followed those links deleted the build stage's sources. MinIO, Mailpit and `cloudflared` are copied from their images pinned by digest; s6-overlay is checked against its published checksums.
- [x] `SH2.2` **Services under s6**, each with a readiness check, in this order:
  1. `postgres`;
  2. `redis` (AOF on, `maxmemory-policy noeviction`, as `docs/ai/rules/data.md` requires);
  3. `minio`;
  4. `mailpit`, unless `SMTP_URL` is set;
  5. a one-shot `init`;
  6. `web` (`cluster.mjs`, `WEB_PROCESSES` defaulting to 2);
  7. `worker`;
  8. `cloudflared`, only when `CLOUDFLARE_TUNNEL_TOKEN` is set.
  - done: 2026-10-04. Order: `setup` (env, `/data`, initdb) → postgres, redis, minio, mailpit → `bootstrap` (waits, role, extensions, bucket, migrate, seed) → web, worker → cloudflared. The crash guard was seen working: Mailpit failing three times stopped the container.

  A service that dies is restarted. If one dies three times in a minute, the container exits,
  so Docker's restart policy and logs show it.
- [x] `SH2.3` **One log stream.** Every service writes to stdout with its name as a prefix. The
  app's JSON lines pass through unchanged, so `docker logs` is the whole system.
  - done: 2026-10-04. Support services are prefixed (`[postgres]`, `[redis]`, `[minio]`, `[mailpit]`, `[tunnel]`); the app's JSON lines are left as they are.
- [ ] `SH2.4` **Size and platforms.** Images for `linux/amd64` and `linux/arm64`, the latter
  for Apple Silicon. The goal is under 1 GB, and the result is recorded in the docs.

### Phase 3 — First start and every start

- [x] `SH3.1` **The `init` one-shot**, idempotent:
  - Create `/data/{postgres,redis,minio,backups}` with the right owners.
  - On first start: `initdb`, `infra/postgres.init.sql`, and the secrets in
    `/data/secrets.env`.
  - On every start:
    - load `/data/secrets.env` under the passed env file (passed values win);
    - create the bucket if it is missing;
    - run the migrations;
    - seed when the catalog is empty.
  - done: 2026-10-04. `wiremap-env.mjs` generates the secrets once (`/data/secrets.env`, `0600`), a passed value wins without rewriting it, and values are single-quoted so a `$` in a password survives.
- [x] `SH3.2` **The env, derived.** The container fills every internal URL itself:
  `DATABASE_URL`, `DATABASE_DIRECT_URL`, `REDIS_CACHE_URL` and `REDIS_QUEUE_URL` (two names,
  one instance), the `S3_*` keys and `SMTP_URL` (Mailpit). Its fixed settings are:
  - `QUEUE_DRIVER=bullmq`, `SCAN_RUNNER=local`, `REALTIME_DRIVER=none`, `S3_ACCESS=proxied`;
  - `WIREMAP_CLI_PATH` pointing at the bundled CLI.
  - done: 2026-10-04. Two required keys were missing on the first run (`AUTH_SESSION_MAX_AGE_SECONDS`, `AUTH_COOKIE_CACHE_MAX_AGE_SECONDS`); they now default to `.env.example`'s values.

  `APP_BASE_URL` defaults to `http://localhost:43000`, and to the tunnel's hostname when one is
  set. The person running it passes only what is genuinely theirs.
- [x] `SH3.3` **Health.** The image's `HEALTHCHECK` calls `/api/health`. `docker ps` shows the
  container healthy only when the database, cache and queue all answer.
  - done: 2026-10-04. Healthy 34 s after a cold start of the image on an existing volume, 15 s after `docker restart`.
- [x] `SH3.4` **Mail without SMTP.** Mailpit's inbox is published only with `-p
  127.0.0.1:48025:48025`. The first-start banner in the logs prints the address and says to
  read the verification mail there.
  - done: 2026-10-04. A sign-up's verification mail arrives in the container's Mailpit, the link verifies, and sign-in works.
- [x] `SH3.5` **The first platform admin.** `docker exec wiremap wiremap-admin grant <email>`
  wraps `pnpm platform:grant` for the first account.
  - done: 2026-10-04. `docker exec <container> wiremap-admin grant <email>`.

### Phase 4 — GitHub from a private machine

- [x] `SH4.1` **The GitHub App for localhost.** `docs/infra/github-app.md` gets a self-hosted
  section:
  - Homepage `http://localhost:43000`.
  - Callback URLs `http://localhost:43000/api/github/setup` first, then
    `http://localhost:43000/api/auth/callback/github`.
  - "Request user authorization during installation" ticked.
  - Webhook inactive unless the tunnel is used.
  - done: 2026-10-04. `docs/infra/github-app.md`, "On your own machine". Registering it against localhost is owed by hand (`TESTS.md`).

  The App's keys go in the env file. GitHub accepts `localhost` callbacks, and the owner checks
  this when registering (`TESTS.md`).
- [x] `SH4.2` **Branch polling, the default without a tunnel.**
  - The hourly `scan-schedule` job (`MaintenanceConsumer.scanSchedule`, which claims due
    projects and calls `TriggerScanUseCase`) gains a step. It moves into a use-case of its own,
    `PollTrackedBranchesUseCase`, so it can be specced. For each tracked repository whose
    project has no webhook delivery in the last day, it reads the default branch's head through the
    installation token. When the head differs from the last scanned commit, it queues a scan
    with trigger `push`. That is one API call per tracked branch per hour.
  - It switches off for an installation once a webhook delivery has been seen. So does
    `GITHUB_POLLING=false`.
  - Specs: a moved head queues one scan and an unchanged head queues none. A recent webhook
    delivery stops polling. One installation's failure does not stop the others.
  - Docs: `packages/application/docs/reference/scan.md`.
  - done: 2026-10-04. `PollTrackedBranchesUseCase` on the hourly `scan-schedule` tick. Heads are kept in the cache a week; a head seen for the first time is recorded, not scanned. A verified webhook marks its installation for a day and polling skips it. Specs: application (4), the GitHub call, and the cross-tenant read against Postgres.
- [x] `SH4.3` **Cloudflare Tunnel, optional.**
  - With `CLOUDFLARE_TUNNEL_TOKEN` (a tunnel made in the Cloudflare dashboard, routing a
    hostname to `http://localhost:43000`), `cloudflared` runs.
  - `APP_BASE_URL`, `AUTH_URL` and `AUTH_TRUSTED_ORIGINS` take the public hostname.
  - The App's webhook URL becomes `https://<hostname>/api/github/webhook`.
  - The doc covers the dashboard steps and what changes in the App's settings.
  - done: 2026-10-04. `CLOUDFLARE_TUNNEL_TOKEN` starts `cloudflared`, and `WIREMAP_PUBLIC_URL` moves every URL to the tunnel's hostname. Running a real tunnel is owed by hand.
- [ ] `SH4.4` **Scans in the container, verified.** The local runner runs on a real
  repository: checkout, a one-commit clone, analyze, a stored graph, and the clone deleted.
  The log shows counts only, with no paths from the repository.
  - Owed by hand: it needs a registered GitHub App. The container side is ready (`SCAN_RUNNER=local`, `git` and the CLI in the image, the worker now starting runners).

### Phase 5 — Running it day to day

- [x] `SH5.1` **`docker/wiremap/compose.yml`**, the same services as separate containers, for
  someone who prefers that shape. One `docker compose up -d`, the same env file and the same
  volume layout.
  - done: 2026-10-04. **Changed from the plan:** the stores (pgvector, Redis, MinIO, Mailpit) are separate containers, and web and worker share one app container: the same image with `WIREMAP_EXTERNAL_STORES=1`. Splitting web from worker too would need a second entrypoint to keep in step for no gain on one machine. The full smoke passes against it.
- [x] `SH5.2` **Backups.**
  - A nightly worker job writes `pg_dump` and the MinIO bucket into `/data/backups`. Seven are
    kept.
  - `docker exec wiremap wiremap-admin backup` runs one now.
  - `docker exec wiremap wiremap-admin restore <file>` restores into a stopped app.
  - Docs: `docs/infra/self-hosted.md`.
  - done: 2026-10-04. **Changed from the plan:** an s6 service, not a worker job, because `pg_dump` is the container's. A backup holds `database.dump`, `objects.tar.gz` and `secrets.env`, without which restored keys cannot be decrypted. Restore drops and recreates the database, makes the extensions as the superuser, then loads as `wiremap` with `--exit-on-error`. Verified on the container: back up, add a project, restore, restart, and the project is gone with the rest intact. An earlier `--clean` restore reached the right state but ignored 564 errors, and was replaced.
- [x] `SH5.3` **Upgrades.** Pull the new image and recreate the container with the same volume.
  The `init` step migrates. A Postgres major-version change is refused with a message that names
  the backup-and-restore steps, rather than starting on an unreadable cluster.
  - done: 2026-10-04. Migrations run on every start (every restart above). A volume holding Postgres 16 is refused with a message, and the container exits without touching it.
- [x] `SH5.4` **Resource defaults.** Postgres shared buffers and Redis memory are sized for a
  laptop, so the whole container idles under 1 GB of memory. The defaults are documented, and
  overridable through env.
  - done: 2026-10-04. 420 MB at idle (`docker stats`). `POSTGRES_SHARED_BUFFERS`, `REDIS_MAXMEMORY` and `WEB_PROCESSES` override the defaults (128MB, 256mb, 2).

### Phase 6 — Verification, CI and docs

- [x] `SH6.1` **CI builds the image**, and a smoke job runs it:
  1. start the container;
  2. wait until it is healthy;
  3. sign up through the API, and read the verification mail through Mailpit's API;
  4. create a project and upload a fixture graph with the CLI against the container;
  5. read it back through `/api/v1`;
  6. stop the container and start it again, then confirm the data is still there.
  - done: 2026-10-04. A `container` job in `.github/workflows/ci.yml` builds the image and runs `tooling/scripts/container-smoke.mjs`, which ends with a restart that must keep the data.
- [x] `SH6.2` **Docs.**
  - `docs/infra/self-hosted.md` opens with the one-container path: the command, the env file,
    the ports, GitHub, the tunnel, backups and upgrades. The kit's VPS guide moves below it.
  - `README.md` gets a "Run it yourself" section.
  - `docs/infra/index.md` gets a row.
  - done: 2026-10-04. `docs/infra/self-hosted.md` opens with the single container (command, env keys, GitHub, backups, upgrades, resources, compose); `README.md` has "Run it yourself"; the infra index points at it.
- [x] `SH6.3` **`TESTS.md` rows**: what CI covers, and what is owed by hand. That is a real
  GitHub App on localhost, a tunnel with live webhooks, and an arm64 machine.
  - done: 2026-10-04. Row `SH` in `TESTS.md`.
- [ ] `SH6.4` **The cloud resources from the free-tier attempt.** These are the Neon project
  `cool-truth-78829166`, the Vercel project `wiremap`, and the Worker `wiremap-dispatcher` with
  its queues `wiremap-jobs` and `wiremap-jobs-dead`. The owner decides whether to keep or delete
  them, and the decision and what was removed are recorded here. `.env.production` stays
  gitignored either way.

**Exit.**
- On a clean machine, `docker run` with an env file holding only the GitHub App's keys gives a
  healthy container within two minutes.
- Signing up, connecting a repository, scanning it, exploring it and asking about it all work
  at `http://localhost:43000`.
- A push to the connected branch is scanned within the hour without a tunnel, and within a
  minute with one.

---

## Verification — the whole plan

```bash
docker build -f docker/wiremap/Dockerfile -t wiremap .
docker run -d --name wiremap -p 127.0.0.1:43000:43000 -v wiremap-data:/data --env-file wiremap.env wiremap
docker inspect --format '{{.State.Health.Status}}' wiremap     # healthy
curl -s localhost:43000/api/health
pnpm check:architecture && pnpm -r --no-bail run test
```

By hand: the exit criteria above on Linux and on an Apple Silicon Mac. Also a restart that
keeps the data, and an upgrade to a newer image that migrates.

## Not in this plan

- Hosting it for other people on the public internet. That is the VPS guide in
  `docs/infra/self-hosted.md`, with a reverse proxy and TLS.
- High availability, replicas, or more than one machine.
- Automatic image publishing to a registry. The image is built locally or in CI until the owner
  picks a registry.

## Changelog

| Date | Who | Change |
|---|---|---|
| 2026-10-03 | @sami | Plan written after the free-tier deploy stopped on Cloudflare's per-account cron limit. |
