---
title: The mail pipeline
description: Why every message is a queue job, why auth mail goes through it too, why there is no delivery table, and where the delivery record actually lives.
---

# The mail pipeline

One path for every message in this system. A caller publishes a *mail request* — a template key,
typed params, a recipient and a locale — and a job lands on `QueueName.MAIL`. The worker renders it
to text and HTML and hands it to `EmailSender`.

```
caller → MailPublisher → BullMQ (QueueName.MAIL) → MailConsumer → SendMailUseCase
                                                                   ├─ MailTemplates  (validate)
                                                                   ├─ MailRenderer   (compose)
                                                                   └─ EmailSender    (transport)
```

Before this, mail left the system from two unrelated places: Better Auth's hooks called a mailer
synchronously inside the auth endpoint, and `InviteMemberUseCase` called a different one after its
commit and swallowed the failure. Nothing recorded whether a message was sent and nothing retried.

## Auth mail goes through the queue too, and that costs something

The tempting exception is to send verification and reset mail inline, because somebody is waiting
for it. It was rejected, and the trade is worth stating plainly rather than discovering:

- **In development, mail only arrives while the worker is running.** A stopped worker is a sign-up
  whose verification link is queued and never rendered. `pnpm dev` starts both, and `.env.example`
  says so at the line.
- In exchange, every message gets the same retries, the same exponential backoff, the same duplicate
  suppression, and one rate limiter. An inline send has none of that, and the first provider outage
  is the first time anyone finds out.

The mitigation is priority, not an exception: auth mail publishes at `high`, which is BullMQ
priority 1 with ten attempts, ahead of anything else on the queue. Doubling from five seconds, ten
attempts wait about forty minutes and `normal`'s eight about ten, so a provider down for a few
minutes delays mail rather than losing it. A message that runs out anyway stays in the failed set
for a week, and `pnpm queue:replay mail` sends it again.

**Batches go as one enqueue.** `MailPublisher.publishMany` sends a digest page or a notification's
recipients as one `addBulk` round trip, each job keeping the priority, attempts and dedupe key a
single `publish` would have given it.

**A `dedupeKey` holds for a day, not for as long as the job is kept.** It used to be the job id.
BullMQ keeps at most a thousand completed jobs, so a digest over a bigger tenant that failed on a
later page and retried re-sent the earlier pages, and those people got the morning's digest twice
(`RV.5`). It is now `onceWithin`, which BullMQ holds as its own key with a TTL. A day covers every
automatic re-send: the digest's key names its day, and an outbox delivery gives up after about three
hours. The one path past it is `pnpm queue:replay` on a job failed more than a day ago, which an
operator runs on purpose. The cost is one small key per keyed message for a day, on the queue
instance.

## There is no delivery table, and that is a decision

An earlier draft of this design wrote every outgoing message to a partitioned `mail_deliveries`
table with `status` and `attempts` columns before queueing it. That was removed, for three reasons
that compound:

1. **BullMQ already supplies what those columns were re-implementing.** Retries, exponential backoff
   and duplicate suppression are queue behaviour. A `status` column beside them is a second
   state machine that can disagree with the first.
2. **At scale, the mail provider is where a delivery record belongs.** A bounce, a complaint and a
   suppression list are things only the provider can tell you. A local table records what this
   process *attempted*, which is the less useful half of the question.
3. **It would put the plaintext invitation token in Postgres.** `invitations` deliberately stores
   only `token_hash`, so that a dump of that table holds nothing anyone can accept an invitation
   with. A mail table carrying the rendered link would hand it straight back.

A dedicated mail log is something an application adds for a stated reason — regulated retention, an
in-app resend history, a provider whose own log expires before the question arrives — not as a
default. The trigger for building one is written down as `C6.10` in
[`plans/archive/COMMUNICATION-PLAN.md`](https://github.com/prodicle/loadbearing_tanstack_start_kit/blob/3fafa78c2f42d2d718236d7666429b858199118a/plans/archive/COMMUNICATION-PLAN.md).

**The outbox event table is the deliberate exception**, and the distinction is the whole point:
Redis cannot commit atomically with Postgres, so an event published from Redis can fire for a change
that rolled back, or vanish if the process dies in between. That is the one place the database write
is load-bearing. A mail request is not — nothing reads it back.

## So where is the delivery record?

Three log lines, and they are the answer to "was it sent":

| Event | Level | Emitted by | Carries |
|---|---|---|---|
| `mail.delivery.queued` | debug | `QueuedMailPublisher` | template, priority |
| `mail.delivery.sent` | info | `MailConsumer` | template, the transport's message id |
| `mail.delivery.failed` | error | `MailConsumer`, final attempt only | template, attempts |

`email.send.failed` stays beside them as the transport's own reason, which `UnavailableError("smtp")`
deliberately does not carry.

**None of the three carries a recipient.** An address is the highest-cardinality field this system
holds, and a log platform is not where it belongs — `event_code` is a Loki label and the catalog is
its cardinality budget.

`mail.delivery.sent` carries the message id because that is the thing a provider webhook would later
correlate against. It is the whole reason `EmailSender.send` returns a receipt rather than `void`,
and the reason `SendMailUseCase` returns it rather than swallowing it: `application` never logs, so
the use-case hands the receipt up and the worker writes the line.

## Why the invitation send still sits after the commit

`InviteMemberUseCase` publishes its mail after `unitOfWork.run` and still wraps it in a
`try`/`catch`. Both look like the thing this pipeline was supposed to fix, and neither is.

After the commit, because a message about a row that rolled back is a link to nothing. And caught,
because the plaintext token cannot ride a durable row — which is what `token_hash` exists to prevent
— so this enqueue is the one step that genuinely cannot be made atomic with the invitation.

The window that leaves is a crash between commit and enqueue: a live invitation whose mail was never
queued. The answer is a resend action rather than a table, filed as `C6.9`. The operator action
today is to invite again, which replaces the row and issues a new token.

## Where each piece lives

| Piece | Where | Why there |
|---|---|---|
| `MailTemplates` (key → params) | `contracts` | `application` has no zod; `contracts` may not import `content` |
| `MailPublisher`, `MailRenderer` | `application/src/port/` | the domain names the seam, not the transport |
| `SendMailUseCase` | `application/src/mail/` | validate, render, send — the only decisions |
| `MailLayout`, `ContentMailRenderer` | `composition/src/mail/` | the one layer that sees both copy and transport |
| `QueuedMailPublisher`, the two mailers | `composition/src/mail/` | adapters, named only in the DI root |
| `MailConsumer` | `apps/worker/src/consumer/` | thin, like an oRPC router |

The recipient's locale rides the request rather than being resolved at render time, which is why
`AuthMailer` takes a `MailRecipient` rather than an address: Better Auth calls its hooks from a
token endpoint carrying no request, so there is nowhere else the person's own language could come
from. It is `users.locale`, an additional field, and `AuthFactory` normalises it rather than
trusting it.

## Templates are hand-written HTML, and there is no template package

A template here is a string, so the one thing a separate package would have bought — a home for
React in a graph whose copy and domain packages are React-free — is not needed. `MailLayout` builds
a table-based document with every style inline, because that is what a mail client renders, and it
is the one place in the repository allowed to write a literal colour: `var(--primary)` reaching an
inbox renders as nothing at all. The exemption is recorded in
[`docs/ai/rules/color.md`](../../../../docs/ai/rules/color.md).

The plain-text part is composed from the same content rather than derived from the HTML. Stripping
tags is how an `&amp;` ends up in a text body and a URL with a query string stops working.

## The swap this is shaped for

Moving from SMTP to a provider API — SES, Postmark, Resend — is one adapter behind the existing
`EmailSender` port, which is exactly the swap that port exists for. That is what buys bounce and
complaint webhooks, suppression lists and a searchable sent log: the delivery record this design
deliberately does not keep. It is filed as `C6.11`, and it moves the dependency entry from Tier 0
(a protocol) to Tier 2 (an SDK behind a port).
