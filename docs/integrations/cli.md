---
title: CLI
description: The wiremap command line — analyze locally, sign in, upload from CI.
---

# CLI

```bash
npx wiremap analyze . -o graph.json      # no account, nothing sent
npx wiremap login --server https://wiremap.example
npx wiremap scan . --project shop-api --branch main --commit "$(git rev-parse HEAD)"
```

In CI, set `WIREMAP_SERVER` and `WIREMAP_API_KEY` and skip `login`. The key needs
`project.scan.run`.

Every command and option, where the login is kept, and how the npm package is built:
[`apps/cli/docs`](../../apps/cli/docs/index.md).
