---
title: VS Code
description: The wiremap extension — the active file's role, imports, dependents and routes in the Explorer.
---

# VS Code

Install `wiremap.vsix` with **Extensions → … → Install from VSIX**. It is built by
`pnpm --filter wiremap-vscode package` into `apps/vscode/dist/`. A **wiremap** view appears in
the Explorer.

It reads the graph from `graph.json` in the workspace folder (`npx wiremap analyze . -o
graph.json`). Otherwise, it reads the project's latest scan: set `wiremap.server` and
`wiremap.project`, then run **wiremap: Set API key**. The key goes into VS Code's secret
storage. The commands are **Show impact of this file**, **Open this file in wiremap** and
**Reload the graph**.

Publishing to the Marketplace needs a publisher account, which is the owner's to create.
See [`apps/vscode/README.md`](../../apps/vscode/README.md).
