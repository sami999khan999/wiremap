---
title: "@loadbearing/graph"
description: The graph algorithms wiremap runs in three places — the browser explorer, the server, the CLI — written once, isomorphic, with no runtime dependency.
---

# `@loadbearing/graph`

The algorithms over a [`GraphDocument`](../../contracts/docs/reference/graph.md). Each one exists once
and runs in three places:
- the explorer in the browser (impact, folders, compare);
- the server (findings at scan completion, Ask's retrieval);
- the CLI and the MCP server.

| | |
| --- | --- |
| **Package** | `@loadbearing/graph` (private) |
| **Depends on** | `@loadbearing/contracts`, **for types only**. There is nothing at runtime |
| **Environment** | isomorphic. It carries the server-only ban, like `content` |
| **Exports** | `GraphIndex`, `GraphDiff` |

**Why a package and not a folder in `feature`:** the server needs the same answers. A diff that
the compare page and the findings job each computed their own way would disagree on what counts
as a new cycle.

See [GraphIndex](reference/graph-index.md).
