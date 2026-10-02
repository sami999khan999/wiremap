---
title: Back-ports
description: Features that exist in lite but not in the big kit, and why each must be added to the big kit to keep the two kits one design.
---

# Back-ports: lite into the big kit

Most changes flow from the big kit into lite. These flow the other way. Each was built in lite first,
and each must also be added to the big kit. Otherwise the two kits stop being one design, and every
later port has to work around the difference.

| Lite feature | What it adds | Status in the big kit |
|---|---|---|
| **Gemini embeddings** | `GeminiEmbeddingProvider` behind `EmbeddingProvider`, chosen by `EMBEDDING_PROVIDER` | not added |
| **Search without an AI key** | `EMBEDDING_PROVIDER=none` falls back to Postgres full-text search through `VectorStore.searchText` | not added |
| **Embedding model per chunk** | chunks record `embedding_model`; switching provider re-indexes instead of mixing vectors | not added |
| **Owner-only docs** | a fourth doc space audience, `owner`, readable only by its author; built in lite `LT3`, migration `0001_doc_owner_audience` | added 2026-10-03, big kit `cdb88c15..3f5bcf1b` on `dev` as migration `0052_doc_owner_audience`; its backlog §17 holds the hand checks |
| **Tailwind, Base UI and `cn`** | the UI stack: Tailwind v4 utilities in each component, the twelve colours as its only palette, Base UI for behaviour, `ThemeScope` for portals; `check-architecture` §32; built in lite `UI1`–`UI4` ([plan](../plans/UI-KIT-PLAN.md)) | added 2026-10-01, big kit `cf6b331f..035bab66` on `dev`, with lite's CI fixes; its backlog §16 holds the hand checks |
| **Doc access links and reader additions** | a doc space or page linked to a module, permission, flag or plan (`DocFeaturePolicy`, migration `0003_doc_access`), hidden as `NOT_FOUND`; whole-docs search grouped by space; breadcrumbs, pager and collapsible sections; tabs, steps, accordions and card icons (renderer 3, `pnpm doc:rerender`); the repository link and Open in ChatGPT / Claude. Also the UI fixes found on the way: Prose's memoised HTML, greys with hue `none`, and sprite symbols keeping their paint. Built in lite `DS0`–`DS6` ([plan](../plans/DOCS-SYSTEM-PLAN.md)) | added 2026-10-03, big kit `cdb88c15..3f5bcf1b` on `dev` as migration `0053_doc_access`; its backlog §17 holds the hand checks |
| **Large docs spaces and the reader's delivery** | one web process per core (`cluster.mjs`); a trimmed nav, the `docSpace.nav` endpoint and a cached space list; one React in the SSR build; reader links as plain anchors; a page's HTML sent once; the doc readers' query plans pinned in specs | added 2026-10-03, big kit `cdb88c15..3f5bcf1b` on `dev`; its backlog §17 holds the hand checks |
| **glass-scroll scrollbars** | `PageScrollbar`, a glass overlay for the page, and the themed thin bar for every inner scroller, coloured only from the twelve | added 2026-10-03, big kit `cdb88c15..3f5bcf1b` on `dev` |
| **The platform organization run like any other** | `platform_admin` holds the whole catalog; Change role, the outrank and last-admin guards, `platformOnly` grants, revoke needs the key, no plan on the platform organization, `platform.doc.grant` to open a space, and the platform menu | added 2026-10-03, big kit `cdb88c15..3f5bcf1b` on `dev`, with all eight platform pages in `PLATFORM_ROUTE_PERMISSION` |

## How to back-port

The same procedure as [Porting](porting.md), in the other direction. Two differences:

1. **The big kit has its full migration history.** Write the change as a new migration there on top
   of its chain, not by regenerating a baseline.
2. **Open a box in the big kit's backlog** (its `plans/BACKLOG.md`) naming the lite commit it came
   from, so the big kit's history records where the change began.

Update the status column above when a back-port lands, and add a row whenever lite gains something
new. **A lite-only feature with no row here is how the two kits drift apart.**
