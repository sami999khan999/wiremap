---
title: Graph explorer
description: How the explorer turns a GraphDocument into a canvas — the view model, the layout, the URL state, saved views — and the budget it is held to.
---

# Graph explorer

`GraphExplorer` (`feature/src/graph/`) has three panes, and fills the viewport under the shell:
- **left:** roles, with their tones and counts;
- **middle:** the canvas;
- **right:** the overview, or the selected node's detail.

It renders a [`GraphDocument`](../../../contracts/docs/reference/graph.md) the route fetches
through `ScanQueries.graph` and `ScanQueries.document`:
1. a five-minute signed URL;
2. the gzipped file;
3. `DecompressionStream`, then the parsed document.

The file is cached by scan id for good, since a graph never changes. A version this build cannot
read shows "scan again" rather than failing.

## The view model

`ExplorerModel.build(document, state)` is pure and linear in files plus edges:
- **Folders** group files by their first `depth` segments (2 by default, so `src/users`). Each one
  shows its file count, the edges crossing it in and out, and its commonest role as a badge.
- **An expanded folder** shows its files inside it. Each file has its role's dot and its own in and
  out counts.
- **Edges** are aggregated between whatever is visible: a folder, or a file of an expanded folder.
  - Each edge counts the imports it stands for. Its stroke thickens with the count.
  - An `inject` edge takes the warning tone and an `api` edge the primary tone; an import is muted.
  - An edge with any uncertain member is dashed.
- **Dimming:**
  - a role highlight dims every file of another role, and every folder with none of that role;
  - "Show impact" dims everything outside the selected file's transitive dependents, and numbers
    each dependent by its distance.
- **Filters** keep one folder or one repository.

`tests/graph/explorer.spec.ts` builds a 5,000-file view in the budget of one second. Locally it
takes tens of milliseconds.

## Layout

`ExplorerLayout.toElk(view)` makes an ELK graph:
- an expanded folder is a parent node whose children are its files;
- edges are routed across the hierarchy (`INCLUDE_CHILDREN`);
- layered left to right, wrapping toward a 1.4 aspect ratio.

The app supplies the `GraphLayouter`: ELK in a classic web worker (`apps/web/src/route/-graph-layout.ts`).
Until it answers, and in tests, `ExplorerLayout.grid` places the nodes, so the canvas is never
blank. The canvas re-fits after each layout, unless a node is selected, and never zooms below 0.55,
so labels stay legible. React Flow renders only the nodes in view.

## State in the URL

`ExplorerUrl` maps the state to short search parameters:
- `depth`;
- `open`, the expanded folders;
- `role`, `folder` and `repo`;
- `sel`, the selected node, which is brought into view on first paint;
- `impact`.

Only what differs from the default is written, so **any URL is a shareable view**, and an
untouched explorer has a bare URL. `scan` picks a scan other than the latest.

## Saved views

A saved view is a name and the explorer's query string, stored in `graph_views`.
- Anyone who can read the project can list and save views.
- A view is removed by its author, or by someone holding `project.settings.manage`.
- Deleting a project sweeps its views, with its scans (`PurgeProjectUseCase`'s tenant-row sweeps).
