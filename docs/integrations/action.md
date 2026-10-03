---
title: GitHub Action
description: Upload a graph from a workflow on every push, for repositories the GitHub App is not installed on.
---

# GitHub Action

A project connected through the GitHub App needs nothing here: wiremap scans it on push. The
Action is for a repository wiremap cannot read. The runner analyzes your checkout, and only
the graph is uploaded.

```yaml
name: wiremap
on:
  push:
    branches: [main]

jobs:
  scan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: sami999khan999/wiremap/apps/action@main
        with:
          server: https://wiremap.example
          api-key: ${{ secrets.WIREMAP_API_KEY }}
          project: shop-api
          # args: --artisan        # Laravel routes from `php artisan route:list`
```

The inputs are in [`apps/action/README.md`](../../apps/action/README.md). Every input
reaches the shell through `env`, never through `${{ }}` inside the script. A crafted input
therefore cannot run as code.
