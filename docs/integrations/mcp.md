---
title: MCP server
description: Give an AI assistant a project's graph — overview, file search, dependencies, impact, routes and cycles — over the Model Context Protocol.
---

# MCP server

`wiremap mcp` serves one graph on stdio. It takes a local file or a project's latest scan.

**Claude Code**

```bash
claude mcp add wiremap -- npx -y wiremap mcp --project shop-api
# or, with no account:
npx wiremap analyze . -o graph.json && claude mcp add wiremap -- npx -y wiremap mcp --graph graph.json
```

**Cursor**, `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "wiremap": {
      "command": "npx",
      "args": ["-y", "wiremap", "mcp", "--project", "shop-api"],
      "env": { "WIREMAP_SERVER": "https://wiremap.example", "WIREMAP_API_KEY": "…" }
    }
  }
}
```

The tools are:
- `overview`, `find_files`, `dependencies` and `dependents`;
- `impact`, `routes`, `route_for_path` and `cycles`.

Ask in plain words, such as "what breaks if I change the user service?", and the assistant
picks the tools. The table of tools and how the protocol is handled are in
[`apps/cli/docs`](../../apps/cli/docs/index.md).
