---
title: Webhooks and Slack
description: Send scan results and new findings to your own endpoint or a Slack channel — setting one up, verifying the signature, and what happens when it fails.
---

# Webhooks and Slack

**Settings → Webhooks** (owner or admin). Choose **Endpoint** or **Slack**, paste an https
URL, pick a project or every project, and pick events: scan succeeded, scan failed, new
finding. **Send test** delivers a test event at once and shows the answer.

**Slack.** Create an incoming webhook in a Slack app for the channel, and paste its URL.
Messages say what happened, with a button back to the project.

**Your own endpoint** gets a JSON POST and a signing secret, shown once. To verify a
delivery, compute HMAC-SHA256 with the secret over `<x-wiremap-timestamp>.<raw body>`. Then
compare it, in constant time, with the hex after `sha256=` in `x-wiremap-signature`:

```ts
import { createHmac, timingSafeEqual } from "node:crypto";

const expected = createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
const given = signature.replace(/^sha256=/, "");
const valid =
  given.length === expected.length && timingSafeEqual(Buffer.from(given), Buffer.from(expected));
```

Refuse a timestamp more than five minutes old. Use `x-wiremap-delivery` to drop a retry you
have already handled.

**Failures.** Anything but a 2xx within ten seconds is a failure, and so is a redirect. A
delivery is retried, eight attempts in all. Twenty failures in a row switch the webhook off.
**Turn back on** resumes it.

Private, loopback and link-local addresses are refused, so a webhook cannot point inside
wiremap's network. The reasoning is in
[`packages/application/docs/reference/webhook.md`](../../packages/application/docs/reference/webhook.md).
