---
title: integrations
description: Every way to reach wiremap from outside the web app — the REST API, the CLI, the GitHub Action, the MCP server, the VS Code extension, and outgoing webhooks.
---

# Integrations

Each one reads with an organization **API key**, created under **Settings → API keys**. The
exception is outgoing webhooks, which wiremap sends to you. A key holds scopes, as a role
does. Reading needs `project.graph.read`, and uploading a graph needs `project.scan.run`.

| Integration | For | Page |
|---|---|---|
| REST API | Anything that speaks HTTP | [api](api.md) |
| CLI | Analyzing on your machine, uploading from CI | [cli](cli.md) |
| GitHub Action | Uploading on every push, without the GitHub App | [action](action.md) |
| MCP server | Claude Code, Cursor and other assistants | [mcp](mcp.md) |
| VS Code | The wiring of the file you are editing | [vscode](vscode.md) |
| Webhooks and Slack | Hearing about scans and findings | [webhooks](webhooks.md) |

Source never leaves your machine through any of these. The CLI and the Action upload the
graph, and the rest read it.
