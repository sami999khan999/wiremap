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
| **Owner-only docs** | a fourth doc space audience, `owner`, readable only by its author; built in lite `LT3`, migration `0001_doc_owner_audience` | not added |
| **Tailwind, Base UI and `cn`** | the UI stack: Tailwind v4 utilities in each component, the twelve colours as its only palette, Base UI for behaviour, `ThemeScope` for portals; `check-architecture` §32; built in lite `UI1`–`UI4` ([plan](../plans/UI-KIT-PLAN.md)) | not added. The largest back-port: `feature` and `apps/web` change with it |

## How to back-port

The same procedure as [Porting](porting.md), in the other direction. Two differences:

1. **The big kit has its full migration history.** Write the change as a new migration there on top
   of its chain, not by regenerating a baseline.
2. **Open a box in the big kit's backlog** (its `plans/BACKLOG.md`) naming the lite commit it came
   from, so the big kit's history records where the change began.

Update the status column above when a back-port lands, and add a row whenever lite gains something
new. **A lite-only feature with no row here is how the two kits drift apart.**
