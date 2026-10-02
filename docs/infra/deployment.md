---
title: deployment
description: Deploying wiremap on free tiers — Neon, Upstash, Backblaze B2, an SMTP provider, Vercel and the Cloudflare dispatcher, in the order each needs the one before it, with every environment key.
---

# Deployment

Wiremap's production shape, entirely on free plans. The budget for each one is
[free-tier](free-tier.md). Running it on a box of your own instead is [self-hosted](self-hosted.md).

```
browser ──▶ Vercel (web app + API) ──▶ Neon Postgres
                  │    ▲               Upstash Redis
     POST /enqueue│    │POST /api/internal/job
                  ▼    │               Backblaze B2
           Cloudflare dispatcher ──── Queues + 3 Cron Triggers
```

> **Not yet run end to end against real accounts.** Every piece was exercised locally: Postgres,
> Redis and MinIO in Docker, and the dispatcher under `wrangler dev`. The first real deploy is owed
> in [`docs/plans/TESTS.md`](../plans/TESTS.md).

Do the steps in order. Each produces values the next one needs.

## 1 · Neon (Postgres)

1. Create a project and a database. Keep two connection strings: the **pooled** one, whose host
   has `-pooler` in it, and the **direct** one.
2. Run the migrations and the seed from your machine against the **direct** URL. The baseline
   creates `vector` and `pg_trgm`, which Neon allows, and sets three per-role timeouts on the role
   it runs as:

   ```bash
   DATABASE_URL=<direct> DATABASE_DIRECT_URL=<direct> pnpm db:migrate
   DATABASE_URL=<direct> DATABASE_DIRECT_URL=<direct> pnpm db:seed
   ```

| Key | Value |
|---|---|
| `DATABASE_URL` | the pooled URL, with `?sslmode=require` |
| `DATABASE_DIRECT_URL` | the direct URL, with `?sslmode=require` |
| `DATABASE_POOL_MAX` | `3`: each Vercel instance holds its own pool, and Neon's pooler fans them in |

## 2 · Upstash (Redis)

Create one Redis database with TLS on. Both names point at it, as they do locally. The kit reads
each by purpose, so splitting them later is a change to `.env` only.

| Key | Value |
|---|---|
| `REDIS_CACHE_URL` | `rediss://default:<password>@<host>:6379` |
| `REDIS_QUEUE_URL` | the same URL |

## 3 · Backblaze B2 (objects)

1. Create a **private** bucket.
2. In its settings, turn on **default encryption (SSE-B2)**, so every graph is encrypted at rest.
3. Add a lifecycle rule: files under `export/` are deleted 7 days after upload. Wiremap cannot set
   this itself, because B2's S3 API has no lifecycle calls.
4. Add a CORS rule allowing `GET` and `PUT` from your Vercel origin. The browser downloads graph
   files, and the scan runner uploads them, through presigned URLs.
5. Create an application key limited to this bucket.

| Key | Value |
|---|---|
| `S3_ENDPOINT` | `https://s3.<region>.backblazeb2.com` |
| `S3_REGION` | the region in that host, for example `us-west-004` |
| `S3_BUCKET` | the bucket name |
| `S3_ACCESS_KEY` / `S3_SECRET_KEY` | the key id and the application key |
| `S3_FORCE_PATH_STYLE` | `false` |
| `S3_CHECKSUMS` | `required`, because B2 refuses the SDK's default checksums |
| `S3_LIFECYCLE` | `false` |

## 4 · Mail

Any SMTP provider with a free tier, such as Brevo or a Gmail app password. Authorise the sending
domain (SPF and DKIM), or the mail lands in spam.

| Key | Value |
|---|---|
| `SMTP_URL` | `smtps://<user>:<password>@<host>:465` |
| `EMAIL_FROM` | `Wiremap <no-reply@your-domain>` |

## 5 · Secrets

```bash
openssl rand -hex 32   # AUTH_SECRET
openssl rand -hex 32   # DISPATCHER_SECRET
openssl rand -hex 32   # INTERNAL_JOB_SECRET
```

## 6 · Vercel (web app and API)

1. Import the repository. Set **Root Directory** to `apps/web`, and the framework preset to
   **Other**.
2. Build command: `cd ../.. && pnpm build:packages && pnpm --filter @loadbearing/web build`.
   Install command: `cd ../.. && pnpm install`. Nitro sees `VERCEL` and writes Vercel's output
   format (`apps/web/vite.config.ts`).
3. Set the environment below, then deploy. Note the origin, for example
   `https://wiremap.vercel.app`.

| Key | Value |
|---|---|
| everything from steps 1–5 | as above |
| `APP_BASE_URL`, `AUTH_URL` | the Vercel origin |
| `AUTH_TRUSTED_ORIGINS` | the Vercel origin |
| `QUEUE_DRIVER` | `cloudflare` |
| `DISPATCHER_URL` | the Worker's URL, from step 7. Set it after step 7, then redeploy |
| `DISPATCHER_SECRET`, `INTERNAL_JOB_SECRET` | from step 5 |
| `REALTIME_DRIVER` | `none` |
| `AUTH_ENROLMENT_MODE` | `personal`, so each sign-up gets an organization of its own |
| `NODE_ENV`, `ENV` | `production` |

`.env.example` documents every other key and its default.

## 7 · Cloudflare (the dispatcher)

Set `WEB_URL` in `apps/dispatcher/wrangler.toml` to the Vercel origin, then follow
[`apps/dispatcher/README.md`](../../apps/dispatcher/README.md#deploying-it): two queues, two
secrets, deploy. Put the Worker's URL into Vercel as `DISPATCHER_URL` and redeploy the web app.

## 8 · Check it

1. `GET <vercel>/api/health` answers 200 with `database`, `cache` and `queue` all true.
2. `GET <worker>/health` answers `ok`.
3. Sign up. The verification mail arrives, which proves the whole round trip: publisher → Worker →
   queue → `/api/internal/job` → mail consumer → SMTP.
4. In the Cloudflare dashboard, the next `13 * * * *` tick shows two deliveries, both acknowledged.

## What to watch

| Signal | Where | Means |
|---|---|---|
| `queue.job.dead` | Worker logs | A job used every attempt; it is on `wiremap-jobs-dead` |
| `queue.job.failed` | Vercel logs | A consumer threw; the Worker will retry it |
| `outbox.drain.lagged` | Vercel logs | Events are waiting more than a minute: drain requests are being lost |
| Neon compute hours | Neon console | Near the cap, something is waking the database more than hourly |
