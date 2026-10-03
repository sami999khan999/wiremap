---
title: "@loadbearing/analyzer"
description: The node-only package that reads source and writes a GraphDocument. The CLI is its only host; it never reaches a web bundle.
---

# `@loadbearing/analyzer`

`Analyzer.run({ repositories })` reads one or more checkouts and returns a
[`GraphDocument`](../../contracts/docs/reference/graph.md).

**This is the only code in wiremap that reads source.** What leaves it is paths, names, line
numbers and counts.

| | |
| --- | --- |
| **Depends on** | `typescript` (the compiler API, for parsing and module resolution), `web-tree-sitter` with `tree-sitter-php`'s WASM grammar, `yaml`, `@loadbearing/graph` |
| **Environment** | Node only. The CLI app is its only host |
| **Exports** | `Analyzer`, `DEFAULT_IGNORE`, `PhpParser` (for a host to call `init` with its own grammar path) |

**Why the compiler API and not ts-morph.** The plan named ts-morph. ts-morph wraps the same API,
and nothing here needs a program or a type checker. `createSourceFile` and `resolveModuleName`
are what it would have called. They are already a catalog dependency, and they keep a
5,000-file repository inside a CI minute.

**Why WASM for PHP.** No native build: the same grammar runs on a laptop and in a GitHub Actions
runner, with nothing to compile. The `tree-sitter-php` package's install script is denied in
`pnpm-workspace.yaml`. Only its `.wasm` is used.

See [Pipeline](reference/pipeline.md) and [Plugins](reference/plugins.md).
