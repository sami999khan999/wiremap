---
title: wiremap CLI
description: Analyze a repository into a graph on your own machine — the commands, the options, what it prints, and how it is built and shipped.
---

# wiremap CLI

`apps/cli` is the analyzer's only host. Its workspace package is `@loadbearing/cli`, and its bin
is `wiremap`. The npm name is chosen when it is published (`WM11.2`): the repository root already
holds the name `wiremap`.

```bash
pnpm --filter @loadbearing/cli build
node apps/cli/dist/index.js analyze path/to/repo -o graph.json.gz
```

```
36 files · 71 imports between files here · 21 routes
frameworks: nestjs
Graph is partial: 72 of 76 imports into this repository resolved (95%)
1 cycles · 1 unused files · 9 unguarded routes
```

That output is `lujakob/nestjs-realworld-example-app`. The four imports that did not resolve are
`../config`, which that repository gitignores.

| Option | |
|---|---|
| `-o, --out <file>` | `.json`, or `.json.gz` to compress. Without it, the JSON goes to stdout and the summary to stderr |
| `--name <owner/repo>` | The repository's name in the graph. The default is the folder's name |
| `--ignore <glob>` | Repeatable. Added to the defaults (`node_modules`, `dist`, `build`, `.next`, `.output`, `vendor`, `coverage`, and others) and to the root `.gitignore` |
| `--tsconfig <path>` | Resolve every file with this tsconfig instead of the nearest one |
| `--artisan` | Read Laravel's routes from `php artisan route:list --json`. This needs PHP and an installed `vendor/` |
| `--pretty` | Indent the JSON |

**`analyze` sends nothing anywhere:** it reads code and writes a file.

## Uploading

```bash
wiremap scan . --project shop-api --server https://wiremap.example.com --api-key wm_...
wiremap upload graph.json.gz --project shop-api --server ... --api-key ... --branch main --commit abc123
```

- `scan` runs `analyze`, then `upload`. Use it where the GitHub App cannot reach the code:
  a self-hosted git server, or a laptop.
- The API key needs `project.scan.run`.
- **Only the graph leaves the machine, never source.** It goes straight to storage through a
  presigned PUT. The server then reads it back, checks it, and records the scan.

## `runner`

`wiremap runner --server <url> --scan <ref> --token <token> [--mask]` is what
`.github/workflows/scan.yml` and the local runner run. It:
1. checks out each repository with its one-repository token;
2. analyzes;
3. uploads;
4. completes.

On any failure it calls `fail` with a message that names no path. See
[scan runner](../../../docs/infra/scan-runner.md).

## Build

`tsup` bundles `src/main.ts` into one ESM file, `dist/index.js`. The workspace packages are
inlined. `typescript`, `web-tree-sitter` and `yaml` stay external npm dependencies.

`tree-sitter-php.wasm` is copied beside the bundle, so an installed CLI needs no native build and
no `tree-sitter-php` package. Run from source (`pnpm --filter @loadbearing/cli dev analyze .`),
the analyzer finds the grammar in its own dependencies instead.

Arguments are parsed by hand in `src/cli/arguments.ts`, without commander. Five flags do not
justify a dependency that is most of a small bundle.
