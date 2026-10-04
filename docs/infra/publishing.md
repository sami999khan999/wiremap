---
title: publishing
description: The public image on Docker Hub — what it holds, how a release reaches prodigycorp/wiremap, the two secrets it needs, and what a stranger who pulls it does first.
---

# Publishing

Wiremap ships as one public image, **`prodigycorp/wiremap`** on Docker Hub, for `linux/amd64`
and `linux/arm64`. It is the image in [self-hosted](self-hosted.md), built from
`docker/wiremap/Dockerfile`, under the AGPL-3.0 in `LICENSE`.

## What a stranger does

```bash
docker run -d --name wiremap -p 127.0.0.1:43000:43000 -p 127.0.0.1:48025:48025 \
  -v wiremap-data:/data prodigycorp/wiremap
```

Then they sign up, verify through the inbox on 48025, run
`docker exec wiremap wiremap-admin grant <email>`, and click **Create GitHub App** under
**Platform → GitHub**. Nothing in the image is anyone's secret: every key is generated on the
first start into that person's own `/data/secrets.env`.

**Why each install makes its own GitHub App.** An App has one private key and one set of
callback URLs. A key inside a public image could be read out of it by anyone, and it would
read every repository every user connected. The callbacks would point at one address, not at
each person's `localhost`. So the image ships no App, and GitHub's manifest flow makes one per
install in a click. How that works is in [github-app](github-app.md), "Create it from wiremap".

The page people read on Docker Hub is `docker/wiremap/README.md`.

## Releasing

`.github/workflows/publish.yml` runs on a version tag:

```bash
git tag v0.1.0 && git push origin v0.1.0
```

| Step | What |
|---|---|
| `smoke` | Builds the image on amd64 and on arm64 and runs `tooling/scripts/container-smoke.mjs` against each, as CI does |
| `push` | Builds both platforms once more with Buildx and pushes them, with provenance and an SBOM |
| description | Copies `docker/wiremap/README.md` to the Docker Hub page |

A tag `v1.2.3` pushes `1.2.3`, `1.2` and `latest`. Running the workflow by hand from the
Actions tab pushes `edge`, which is how to try an image before a release.

## Before the first release

1. On Docker Hub, create the repository `prodigycorp/wiremap` as **public**. A push creates it
   too, but then it starts out private.
2. Create a personal access token under **Account settings → Personal access tokens**, with
   **Read, Write, Delete**. Writing the repository description needs the third scope as well.
3. In the GitHub repository, under **Settings → Secrets and variables → Actions**, add
   `DOCKERHUB_USERNAME` (the Docker Hub user or organization member) and `DOCKERHUB_TOKEN`.

The image name lives in one place, `IMAGE` in `publish.yml`. Change it there and in
`docker/wiremap/README.md`.

## Licence

The AGPL-3.0 lets anyone run, change and share wiremap. Anyone who offers a changed version to
others over a network must offer those users its source too. The image carries the licence at
`/app/LICENSE` and in its `org.opencontainers.image.licenses` label. The CLI's npm package and
the VS Code extension declare `AGPL-3.0-only` and ship the same file.
