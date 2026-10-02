---
title: free tier
description: Every vendor wiremap runs on, the free quota it lives inside, what wiremap spends it on, and what happens when it runs out.
---

# Free tier

**Wiremap runs on free plans only.** This page is the budget. Each row is one vendor: the quota,
what spends it, and the failure you see when it runs out.

> **Quotas change.** These are the published free tiers as of 2026-10-03. The Cloudflare figures
> were checked against Cloudflare's own docs that day. Re-check every row on the vendor's pricing
> page before relying on it.

| Vendor | Free quota | Wiremap spends it on | When it runs out |
|---|---|---|---|
| **Vercel Hobby** | Non-commercial use only. About 1M function invocations and 4 hours of active CPU a month; a function runs for up to 300 s | Every page, every API call, and every job (`/api/internal/job`) | Requests fail until the month resets. **Charging money means moving to Pro first**: Hobby's terms forbid it |
| **Cloudflare Workers** | 100,000 requests a day, 10 ms CPU per invocation | The dispatcher: `/enqueue` calls and queue deliveries | Enqueues are refused and the publisher throws; the caller sees an error |
| **Cloudflare Queues** | 10,000 operations a day, 24-hour retention | About 3 operations per job (write, read, ack), so about 3,000 jobs a day | Sends are refused; a message older than 24 hours is lost |
| **Cloudflare Cron Triggers** | 5 per account (wiremap uses 3) | Hourly backstop, nightly maintenance, morning digest | — |
| **Neon** | 0.5 GB storage, about 100 compute-hours a month; compute suspends after 5 idle minutes | All domain data | Writes fail at the storage cap; past the compute hours the database stops until the month resets |
| **Upstash Redis** | 256 MB, 500,000 commands a month | Sessions (Better Auth secondary storage), capability and flag caches, rate limits, queue dedup claims | Commands are refused: sessions fall back to the database, rate limits fail open |
| **Backblaze B2** | 10 GB stored; downloads free up to 3× storage; 2,500 class B and C calls a day | Graph files (`graphs/…`), doc images, tenant exports | Uploads fail at the cap; reads past the daily call limit are refused until the next day |
| **GitHub Actions** | Unlimited minutes for a public runner repository; 2,000 minutes a month for a private one | Scans, about 1–3 minutes each | Scans queue and fail with the runner's error |
| **Gemini** | **Each organization's own key.** Wiremap has no key of its own | Ask answers | That organization's Ask stops; nobody else is affected |
| **SMTP** | Depends on the provider (Brevo: 300 a day; Gmail: 500 a day) | Verification, reset, invitations, digests, alerts | The mail job retries for about ten minutes, then is logged as `mail.delivery.failed` |

## The three rules that keep it inside

1. **Nothing wakes Neon more than hourly.** BullMQ drained the outbox every second. Wiremap
   drains it in a job queued five seconds after the write, and the dispatcher's hourly cron is the
   backstop ([cloudflare-queue](../../packages/infrastructure/docs/reference/cloudflare-queue.md)).
   An idle deployment costs about 5 minutes of compute an hour.
2. **Nothing is pushed.** The bell polls every 60 seconds and only while the tab is visible
   ([realtime](../scale/realtime.md)). There is no stream process to host.
3. **No platform AI key.** Ask runs on the organization's own Gemini key or not at all, so one
   heavy user cannot spend everyone's quota.

## Where the Redis commands go

At 500,000 a month, Redis is the tightest quota. Rough costs per action:

| Action | Commands |
|---|---|
| A signed-in page load | 1–3 (session, capabilities; the session cookie cache absorbs most) |
| An API call with a rate limit | 2 |
| Publishing a job with a dedup key | 1 |

About 10,000 page loads a day fits. Past that, move to Upstash's pay-as-you-go plan: it is the
first quota a growing deployment hits.
