---
title: GitHub App
description: The GitHub App wiremap reads repositories through — created from the platform screen in one click, or registered by hand with the env keys — and what the server does with each token.
---

# GitHub App

Wiremap reads repositories through **one GitHub App** that belongs to your deployment. The App
is free, and so is everything it does here. **Create it from wiremap** in one click, or
**register it by hand** and pass its keys in the environment. An App in the environment wins.

**What the App is used for:**
- the "connect repositories" picker, which lists the repositories each installation can see;
- the push webhook, which (from `WM6.5`) starts a scan;
- reading one file at a commit for Ask (`WM9.4`), which is never stored.

**The App's private key never leaves the server.** Every token is minted per use, narrowed to one
repository with `contents: read`, and never written anywhere.

## Create it from wiremap

A platform admin opens **Platform → GitHub** and clicks **Create GitHub App**. This uses
GitHub's [App Manifest flow](https://docs.github.com/en/apps/sharing-github-apps/registering-a-github-app-from-a-manifest):

1. `platform.startGithubApp` builds a manifest from `APP_BASE_URL`. It has the same URLs and
   permissions as the table below. The webhook is included only when that address is public
   `https`. The browser posts the manifest to `github.com/settings/apps/new`, or to an
   organization's settings page when one is named.
2. GitHub shows the App filled in. The person can rename it, then clicks **Create**.
3. GitHub redirects to `/api/github/manifest` with a one-time `code`. The code is valid for an
   hour. Wiremap exchanges it at `POST /app-manifests/{code}/conversions` for the App's id,
   slug, private key, webhook secret and OAuth pair.
4. All three secrets are stored encrypted in `github_apps`, a one-row catalog table. They are
   encrypted with `SECRET_ENCRYPTION_KEY`, so the screen refuses to create an App without one.

**The `state` is signed for the person who started it** (`HttpsGithubAppGateway`). A code that
comes back under anyone else's state is refused before it is spent. Without that check, a link
pasted to an admin could install an App that someone else owns on GitHub.

**Every process picks it up without a restart.** `StoredGithubAppProvider` reads the row
whenever it has none. Once it finds one, it keeps it for a minute. **Remove the App** on the
same screen forgets it, and other processes stop using it within that minute. It stays on
GitHub until its owner deletes it there. Repositories connected through it stop scanning until
they are connected through a new App.

GitHub sign-in (`/api/auth/callback/github`) still reads only `GITHUB_CLIENT_ID` and
`GITHUB_CLIENT_SECRET` from the environment. An App created on the screen connects
repositories. It does not add a "Sign in with GitHub" button.

## Register it

On GitHub, go to **Settings → Developer settings → GitHub Apps → New GitHub App**. Fill in:

| Field | Value |
|---|---|
| App name | anything; its URL slug becomes `GITHUB_APP_SLUG` |
| Homepage URL | your `APP_BASE_URL` |
| Callback URLs | first `${APP_BASE_URL}/api/github/setup`, then `${AUTH_URL}/api/auth/callback/github` for GitHub sign-in |
| Request user authorization (OAuth) during installation | **ticked**: it is what proves who installed (see the flow) |
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
2. Under "Client secrets", generate one. The client id and secret are `GITHUB_CLIENT_ID` and
   `GITHUB_CLIENT_SECRET`: connecting an installation needs them, and so does GitHub sign-in.

## The env keys

```bash
GITHUB_APP_ID=123456
GITHUB_APP_SLUG=wiremap-yourname
# The .pem on one line, newlines as \n. Vercel also takes it multi-line.
GITHUB_APP_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\nMIIE...\n-----END RSA PRIVATE KEY-----\n"
GITHUB_WEBHOOK_SECRET=...
# The App's OAuth pair. Without it no installation can be connected, and there is no
# GitHub sign-in.
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
  G-->>U: redirect to /api/github/setup?installation_id&code&state
  U->>W: /api/github/setup
  W->>W: state signed for the caller's active org, under an hour old
  W->>G: exchange code for a user token, GET /user/installations
  W->>W: installation_id is in that list, and bound to no other org
  W->>G: GET /app/installations/:id (App JWT)
  W->>W: bind (org, installation), audit github.installation.bound
  W-->>U: /projects/new?github=connected
```

- **The `state` is signed with `AUTH_SECRET`** and carries the organization id and the time. A
  callback whose state names another tenant is refused. That stops a link pasted to someone else
  from binding their installation to your organization.
- **The installation id is a plain query parameter, so the state alone proves nothing about
  it.** Every installation of the App exists, so checking existence proved nothing either.
  The user token from `code` lists the installations the person in the browser can see. The id
  must be among them, and the token is used for that one call and then dropped. Without this,
  anyone could type someone else's installation id and read their repositories (`WM12.1`).
- **One installation, one organization.** Binding an installation that another organization
  already holds is refused. Two tenants sharing an installation would share its repositories.
- **To check on a real App:** that GitHub sends the install redirect to the *first* callback
  URL, and that it passes `state` through with `code`. Both are owed in `docs/plans/TESTS.md`.

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

## On your own machine (the single container)

The container runs at `http://localhost:43000`, and GitHub accepts `localhost` for an App's
URLs. **Creating the App from wiremap does all of this for you**, for whatever address
`WIREMAP_PUBLIC_URL` names. To register one by hand instead, register a separate App for the
container, because an App has one set of URLs:

| Field | Value |
|---|---|
| Homepage URL | `http://localhost:43000` |
| Callback URLs | first `http://localhost:43000/api/github/setup`, then `http://localhost:43000/api/auth/callback/github` |
| Request user authorization (OAuth) during installation | ticked |
| Webhook | **Active unticked**, unless you run the tunnel below |

The permissions are the same as above. Put the App's keys in the env file the container starts
with: `GITHUB_APP_ID`, `GITHUB_APP_SLUG`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_WEBHOOK_SECRET`,
`GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET`.

Everything except webhooks works this way:
- Connecting happens in your browser, which reaches `localhost`.
- Reading repositories and minting tokens are calls the container makes outward.
- Scans run inside the container (`SCAN_RUNNER=local`).

GitHub cannot deliver a push to a machine it cannot reach, so the container polls instead.

**Polling, on by default.** Each hourly tick reads the head of every tracked branch and scans the
ones that moved, so a push is scanned within the hour. That costs two API calls per tracked
branch per hour, well inside an installation's 5,000. An installation that has delivered a
webhook in the last day is skipped, since webhooks already cover it. `GITHUB_POLLING=false`
turns polling off.

**A Cloudflare Tunnel, for scans within seconds.** In the Cloudflare dashboard, go to **Zero
Trust → Networks → Tunnels → Create a tunnel** (free). Route a hostname you own, such as
`wiremap.example.com`, to `http://localhost:43000`. Then:
1. Start the container with `CLOUDFLARE_TUNNEL_TOKEN=<the tunnel's token>` and
   `WIREMAP_PUBLIC_URL=https://wiremap.example.com`.
2. In the App, change every `localhost` URL above to that hostname. Tick **Active** for the
   webhook, with URL `https://wiremap.example.com/api/github/webhook`.

The tunnel uses no cron trigger and no open port: `cloudflared` dials out. From then on, use
the public hostname in your browser too, because sign-in cookies are set for it.

## Costs

None. GitHub Apps are free. A scan's Actions minutes are counted in [free tier](free-tier.md).
