# Dispatcher

The Cloudflare Worker that schedules wiremap's background work. **It runs no business logic.** It
holds a Cloudflare queue and three Cron Triggers, and turns every message and tick into a signed
`POST /api/internal/job` on the web app, where the kit's consumers run in Node.

It only ever waits on `fetch`, which is what keeps it inside the free plan's 10 ms of CPU per
invocation. The round trip, the signature scheme and what changes from BullMQ are in
[`cloudflare-queue.md`](../../packages/infrastructure/docs/reference/cloudflare-queue.md).

## What it does

| Handler | Trigger | Does |
|---|---|---|
| `fetch` | `POST /enqueue` from the web app | Checks the signature, then `JOBS.sendBatch` |
| `fetch` | `GET /health` | Answers `ok` |
| `queue` | a batch on `wiremap-jobs` | Posts each message to the web app. 2xx acks; otherwise it retries from 5 s doubling to an hour, and after the job's `maxAttempts` sends it to `wiremap-jobs-dead` |
| `scheduled` | `13 * * * *` | Outbox drain backstop, spare tenants |
| `scheduled` | the 03 UTC tick of `13 * * * *` | Partitions, cleanup, orphans, retention |
| `scheduled` | the 07 UTC tick of `13 * * * *` | The daily digest fan-out |

One Cron Trigger rather than three: the Workers Free plan allows five per **account**, and
the hour of the tick decides what else it enqueues.

No cron is more frequent than hourly, so Neon's compute can suspend between ticks.

## Running it locally

```bash
cp apps/dispatcher/.dev.vars.example apps/dispatcher/.dev.vars   # then fill both secrets
# in .env: QUEUE_DRIVER=cloudflare, DISPATCHER_URL=http://localhost:8787 and the same two secrets
pnpm dev:web
pnpm dev:dispatcher                                              # wrangler dev, queues simulated
curl "http://localhost:8787/__scheduled?cron=13+*+*+*+*"         # fire a cron by hand
```

## Deploying it

```bash
pnpm --filter @loadbearing/dispatcher exec wrangler queues create wiremap-jobs
pnpm --filter @loadbearing/dispatcher exec wrangler queues create wiremap-jobs-dead
pnpm --filter @loadbearing/dispatcher exec wrangler secret put DISPATCHER_SECRET
pnpm --filter @loadbearing/dispatcher exec wrangler secret put INTERNAL_JOB_SECRET
pnpm --filter @loadbearing/dispatcher run deploy
```

Set `WEB_URL` in `wrangler.toml` to the Vercel origin first. The full order across every vendor is
in [`docs/infra/deployment.md`](../../docs/infra/deployment.md).
