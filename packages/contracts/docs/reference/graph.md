---
title: GraphDocument
description: The versioned file a scan produces — files, edges, routes, calls, coverage and insights — what each field means and who reads it.
---

# GraphDocument

A scan produces **one file**: a `GraphDocument`, stored gzipped at
`graphs/<organizationId>/<projectId>/<scanId>.json.gz`.

**What reads it:**
- the explorer in the browser;
- the server, for Ask and the public API;
- the CLI and the MCP server, from a local `graph.json`.

**Postgres keeps only a summary:** the scan row, its counts and its findings. Nothing is stored per
file. `GraphContract.document` is the zod schema all of them parse it with.

## Versioning

`version` is the literal `1`. **A reader refuses any version it does not know.** It does not
guess. The analyzer and the explorer ship from one commit, so a version bump lands in both at once.
An old stored graph keeps its version, and the explorer shows "rescan to view" for it.

## Fields

| Field | What |
|---|---|
| `meta` | Analyzer version, when it ran, each repository's name, commit and branch, and the total time |
| `languages` | File counts per language: `typescript`, `javascript`, `php` |
| `frameworks` | What was detected, and in which repository |
| `files` | `path` (unique in the document), repository, language, `role` (one of `FILE_ROLES`), lines, exported names |
| `edges` | `from` → `to`, the `kind` (`import`, `inject` or `api`), whether it is `certain`, and the imported `names` |
| `unresolved` | Imports that look internal (relative or aliased) and resolved to nothing |
| `coverage` | `resolved` of `total` internal imports. This is the explorer's "graph is partial" banner |
| `routes` | Backend routes: `id` (`METHOD path`), method, path, file and line, framework, guards, and the `source` (`static`, `openapi` or `artisan`) |
| `calls` | Frontend calls: file and line, method, normalised URL (`/users/:param`), and the matched route id or null |
| `insights` | Most depended-on files, cycles, unused files and exports, and unguarded routes, all computed at scan time |

## Paths

A path is relative to its repository's root, with `/` separators. A **multi-repository** project
prefixes each path with the repository's name (`web/src/app.tsx`, `api/src/main.ts`), so a path is
still unique and an `api` edge can cross repositories.

## Bounds

Every array is capped (200,000 files; edges five times that). The server also refuses a
graph over 25 MB gzipped before it ever parses one (`WM6.3`). The caps make a hostile upload
cheap to refuse, rather than expensive to accept.

**No source code is in the document.** It holds paths, names, line numbers and counts. The analyzer
reads the code, but nothing in this file carries it.
