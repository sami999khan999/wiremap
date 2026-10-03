---
title: Scan runner
description: Where a scan's analysis runs — GitHub Actions in production, a child process in development — how the runner authenticates without a secret in its input, and how to set it up.
---

# Scan runner

A scan reads code, and **the web app never does**. Analysis runs in one of two places, chosen by
`SCAN_RUNNER`:

| `SCAN_RUNNER` | Where | Needs |
|---|---|---|
| `github` | `.github/workflows/scan.yml`, run by `workflow_dispatch` in `WIREMAP_RUNNER_REPO` | The three settings below |
| `local` | `node apps/cli/dist/index.js runner …` as a detached child process | A built CLI (`pnpm --filter @loadbearing/cli build`) and `git` on the machine |
| `none` (default) | Nowhere. "Scan now" is refused with a message; CLI uploads still work | Nothing |

## The protocol

1. **Queue.** "Scan now", a push to a tracked branch, or a project's schedule queues a scan, at
   most one per project at a time. A job on `QueueName.SCAN` calls `ScanRunner.dispatch`, so a
   GitHub blip is retried instead of lost.
2. **Run.** The workflow (or the child process) gets **only the scan reference**,
   `<organizationId>.<scanId>`. It derives its token itself:

   ```bash
   printf 'scan:%s' "$SCAN" | openssl dgst -sha256 -hmac "$WIREMAP_RUNNER_SECRET" -binary | base64 | tr '+/' '-_' | tr -d '=\n'
   ```

   The server computes the same value (`HmacScanTokens`). **No credential is ever a workflow
   input**, because inputs show in a public repository's run page. The spec in
   `infrastructure/tests/scan/scan-adapters.spec.ts` pins one derived value, so the two sides
   cannot drift apart unnoticed.
3. **Callbacks**, each a `POST /api/scan/<ref>/<step>` with `authorization: Bearer <token>`:

| Step | Accepts a scan that is | Does |
|---|---|---|
| `checkout` | queued | Moves it to running. Returns each repository's name, its ref, and a **read-only token for that one repository**, minted per scan and never stored. Also returns the project's ignore list and tsconfig override |
| `upload` | running | Returns a presigned PUT for `graphs/<org>/<project>/<scan>.json.gz` |
| `complete` | running | The server reads the graph back, checks its size (25 MB gzipped at most) and schema, and records counts and findings |
| `fail` | queued or running | Records the runner's message, capped at 500 characters |

A finished scan refuses every step, so a captured token is worthless once its run is over.

**A scan queued or running for over 30 minutes is failed** by the hourly sweep (`scan-sweep` on
the maintenance queue). The workflow's own timeout is 20 minutes.

## Setting up the GitHub runner

The runner repository can be this repository, since `scan.yml` is in it.

1. **Server env:**
   - `SCAN_RUNNER=github`;
   - `WIREMAP_RUNNER_REPO=owner/name`;
   - `WIREMAP_RUNNER_TOKEN`: a fine-grained token with **Actions: Read and write** on that
     repository only;
   - `WIREMAP_RUNNER_SECRET`: `openssl rand -hex 32`.
2. **Runner repository:**
   - a secret named `WIREMAP_RUNNER_SECRET`, with the same value;
   - a variable named `WIREMAP_SERVER_URL`, set to your `APP_BASE_URL`.
3. **Minutes.** A public runner repository runs free and unmetered. A private one spends the
   account's 2,000 free minutes a month; see [free tier](free-tier.md).

Without `WIREMAP_RUNNER_SECRET`, the server signs tokens with `AUTH_SECRET`. That is enough for
the local runner and for CLI uploads. The workflow cannot derive those tokens, so `github` stays
off until the secret is set.

## What a run logs

The runner prints counts and frameworks only, never a path from the scanned code:
- each repository token is masked as the checkout returns it (`--mask`);
- the scan token is masked before it is written to the environment;
- a clone failure is reported by repository name, because git's own message can carry the URL.
