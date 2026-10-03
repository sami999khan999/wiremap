---
title: GitHub App
description: Registering the GitHub App wiremap reads repositories through — permissions, events, URLs, the four env keys — and what the server does with each token.
---

# GitHub App

Wiremap reads repositories through **one GitHub App** that you register for your deployment. The
App is free, and so is everything it does here.

**What the App is used for:**
- the "connect repositories" picker, which lists the repositories each installation can see;
- the push webhook, which (from `WM6.5`) starts a scan;
- reading one file at a commit for Ask (`WM9.4`), which is never stored.

**The App's private key never leaves the server.** Every token is minted per use, narrowed to one
repository with `contents: read`, and never written anywhere.

## Register it

On GitHub, go to **Settings → Developer settings → GitHub Apps → New GitHub App**. Fill in:

| Field | Value |
|---|---|
| App name | anything; its URL slug becomes `GITHUB_APP_SLUG` |
| Homepage URL | your `APP_BASE_URL` |
| Callback URL | `${AUTH_URL}/api/auth/callback/github`, used for GitHub sign-in |
| Setup URL | `${APP_BASE_URL}/api/github/setup`, with **Redirect on update** ticked |
| Webhook URL | `${APP_BASE_URL}/api/github/webhook` |
| Webhook secret | `openssl rand -hex 32`, which becomes `GITHUB_WEBHOOK_SECRET` |

**Repository permissions** (all read-only):

| Permission | Access | Why |
|---|---|---|
| Contents | Read | checkout for a scan, and one file for Ask |
| Metadata | Read | required by GitHub; repository names and default branches |

**Organization and account permissions:** none.

**Subscribe to events:** `Push` and `Repository`. The `installation` and
`installation_repositories` events are always sent to an App, so you do not tick them.

**Where can this App be installed:** "Any account" if people outside your own GitHub account will
connect repositories, otherwise "Only on this account".

After you create the App:
1. Generate a private key and download the `.pem`.
2. Under "Client secrets", generate one. The client id and secret are the sign-in pair.

## The env keys

```bash
GITHUB_APP_ID=123456
GITHUB_APP_SLUG=wiremap-yourname
# The .pem on one line, newlines as \n. Vercel also takes it multi-line.
GITHUB_APP_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\nMIIE...\n-----END RSA PRIVATE KEY-----\n"
GITHUB_WEBHOOK_SECRET=...
# Sign-in with GitHub. Optional, and independent of the four above.
GITHUB_CLIENT_ID=Iv1....
GITHUB_CLIENT_SECRET=...
```

**The four `GITHUB_APP_*` and `GITHUB_WEBHOOK_SECRET` keys go together.** If any one is missing,
the container binds `NullRepositoryProvider`, the "Connect GitHub" button is replaced by a notice,
and projects can still take graphs uploaded from the CLI (`WM6.6`).

## The flow

```mermaid
sequenceDiagram
  participant U as Browser
  participant W as wiremap
  participant G as GitHub
  U->>W: /projects/new, Connect GitHub
  W-->>U: github.com/apps/<slug>/installations/new?state=<org.time.hmac>
  U->>G: install, pick repositories
  G-->>U: redirect to /api/github/setup?installation_id&state
  U->>W: /api/github/setup
  W->>W: state signed for the caller's active org, under an hour old
  W->>G: GET /app/installations/:id (App JWT)
  W->>W: bind (org, installation), audit github.installation.bound
  W-->>U: /projects/new?github=connected
```

- **The `state` is signed with `AUTH_SECRET`** and carries the organization id and the time. A
  callback whose state names another tenant is refused. That stops a link pasted to someone else
  from binding their installation to your organization.
- **One installation can be bound to two organizations** (one GitHub account, two wiremap tenants).
  The key is `(organization_id, installation_id)`.

## Webhooks

`/api/github/webhook` reads the raw body and checks `X-Hub-Signature-256` in constant time. A bad
signature gets 401. Anything verified gets 202, whether it was applied or ignored: GitHub does not
retry, so a 5xx would only fill its delivery log.

| Event | Action | Effect |
|---|---|---|
| `installation` | `deleted` | the installation is unbound from every organization |
| `installation` | `suspend` / `unsuspend` | marked suspended, shown on the connect panel |
| `repository` | `renamed` / `transferred` | every project tracking it follows the new name |
| `push` | | ignored until scans exist (`WM6.5`), then a scan on a tracked branch |

## Costs

None. GitHub Apps are free. A scan's Actions minutes are counted in [free tier](free-tier.md).
