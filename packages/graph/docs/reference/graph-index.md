---
title: GraphIndex and GraphDiff
description: What each query returns, how it is computed, and the linear-time budget the 20,000-file benchmark holds it to.
---

# GraphIndex and GraphDiff

`GraphIndex.from({ files, edges })` builds adjacency in both directions over integer ids, once.
**Edges to a path that is not in `files` are dropped** (package imports, for example). So are
duplicate pairs: two imports of one file are one edge.

| Query | Returns |
|---|---|
| `imports(path)` / `importers(path)` | Direct neighbours |
| `dependencies(path, depth?)` | What `path` needs, transitively, nearest first, each with its depth |
| `dependents(path, depth?)` / `impact(path)` | What needs `path`: everything a change to it can break |
| `cycles()` | Strongly connected components of two or more, plus files that import themselves. Members are sorted, largest first |
| `mostDepended(n)` | Files by the number of distinct files importing them |
| `unusedFiles(entries)` | Files no entry point reaches. The plugins and `package.json` supply the entries |
| `unusedExports(files, entries)` | Exports no edge imports by name. A file imported whole (`*`) has none unused |
| `folders(depth)` | Files grouped by their first `depth` folders, with the edges that cross groups counted |

`GraphDiff.between(before, after)` reports files, edges and routes added and removed, and cycles
introduced and fixed. **Cycles are matched by their sorted members**, so a reordered cycle is the
same cycle.

## Cost

Every query is linear in what it touches. **`cycles()` is Tarjan's algorithm, written
iteratively**, because a 20,000-file import chain overflows the JavaScript stack under recursion.

`tests/graph-index.bench.spec.ts` runs this on 20,000 files and about 100,000 edges, with a chain
through all of them:
- build;
- cycles;
- folders at depth 2;
- the top ten;
- one impact query.

The spec allows three seconds. Locally it takes about 300 ms.
