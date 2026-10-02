---
title: mailpit
description: The SMTP sink — every outbound mail is caught and displayed, none is delivered. One env var separates it from a real provider.
---

# `mailpit`

```yaml
mailpit:
  image: axllent/mailpit:latest
  ports:
    - "${SMTP_PORT:-41025}:1025"     # SMTP — what the worker dials
    - "${MAILPIT_UI_PORT:-48025}:8025" # web UI — what you read
  healthcheck:
    test: ["CMD", "/mailpit", "readyz"]
```

No config file and no volume. Every setting is a flag or a default, and the inbox is in memory —
`pnpm infra:down` empties it, which is the correct behaviour for a scratch mailbox.

## What it is for

`SmtpEmailSender` in `packages/infrastructure/src/smtp/` dials `SMTP_URL`, which is
`smtp://localhost:41025` locally. Mailpit accepts the message, **delivers it nowhere**, and shows it
at <http://localhost:48025>.

The transport is **pooled** — up to five connections, each recycled after a hundred messages — and
bounded: ten seconds to connect and greet, thirty of silence mid-send. A hung server fails the send
as `UNAVAILABLE`, which the queue retries, rather than holding the job for nodemailer's minutes.
The pool connects on the first send, so a process that never mails opens no socket.

> [!IMPORTANT]
> **It cannot send mail to a real address, and that is the feature.** A misaddressed digest during
> development reaches an inbox you own rather than a customer. The day this is swapped for a real
> provider is the day that stops being true.

## Reading what was sent

```bash
open http://localhost:48025          # the UI — subject, recipients, HTML and text parts
curl -s localhost:48025/api/v1/messages | jq '.messages[0].Subject'
```

The API is what makes it usable from a test: send, then assert on what arrived, without a
provider's sandbox or a fake in the container.

## The swap

One environment variable, no code change:

```
SMTP_URL=smtp://localhost:41025                    # mailpit
SMTP_URL=smtps://user:key@smtp.provider.com:465   # any real provider
```

`smtps://` for implicit TLS on 465, `smtp://` with STARTTLS on 587. The sender behind the port reads
the URL and nothing else, which is what keeps the provider a deployment decision rather than a
dependency — see [Dependencies](../../opinions/dependencies.md) on Tier 0.

## The healthcheck is unusual, and deliberately so

The image ships neither `wget` nor `curl`, so the usual `CMD curl -f …` probe fails with
`executable file not found` and the container sits `unhealthy` forever while working perfectly.
`/mailpit readyz` is the binary answering about itself — the probe the project documents.

## What to check when it is wrong

| Symptom | Usually |
|---|---|
| Worker logs `ECONNREFUSED :41025` | Container not up — `pnpm infra:up` |
| Worker logs `ECONNREFUSED :1025` | `SMTP_URL` points at the container port from the host — use `41025` |
| Mail sends, UI is empty | Two Mailpits — check nothing else owns 41025 |
| `unhealthy`, but mail arrives | The healthcheck was changed to `curl`; see above |
| Inbox empty after a restart | Working as designed — no volume, memory only |
