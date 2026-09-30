---
title: embedding
description: The three ways lite searches documents — lexical with no provider, OpenAI, or Gemini — how the container picks one, what switching providers does to the corpus, and the trade-offs.
---

# Embedding providers and lexical search

Semantic search is one switch, `EMBEDDING_PROVIDER`, read once by the container.

| `EMBEDDING_PROVIDER` | Search | Indexing | Needs |
|---|---|---|---|
| `none` (the default) | Postgres full-text search over the chunk text | text only, `embedding` null | nothing |
| `openai` | cosine distance over `vector(1536)` | text and a vector | `EMBEDDING_API_KEY` |
| `gemini` | the same | the same | `EMBEDDING_API_KEY` |

`Container.buildSearchMode` turns the setting into a `SearchMode`: `lexical`, or `semantic` with an
`EmbeddingProvider`. `IndexDocumentUseCase`, `SearchDocumentsUseCase` and `ReembedChunksUseCase`
branch on that value and nothing else. No use-case names a vendor, and none asks which class it was
handed. A third provider, such as a local model, is one more adapter and one more `case`.

## The two adapters

Both are `fetch` against the vendor's REST endpoint. There is no SDK, so there is no new catalog
entry.

- **`OpenAiEmbeddingProvider`** posts `/embeddings` in batches of 96. `dimensions` is sent, so the
  model is cut to the column's width. It ignores `purpose`, because OpenAI embeds a query and a
  document the same way.
- **`GeminiEmbeddingProvider`** posts `models/<model>:batchEmbedContents` in batches of 100, with the
  key in `x-goog-api-key` rather than the query string. It sends `outputDimensionality`, so its
  vectors share the `vector(1536)` column with OpenAI's. `purpose` maps to `taskType`: a document is
  `RETRIEVAL_DOCUMENT` and a query is `RETRIEVAL_QUERY`. Gemini embeds the two differently, and
  mixing them up costs recall.

Both answer a failed or short response with `UNAVAILABLE`, which is retryable, so the embedding
consumer tries again rather than dead-lettering a blip. An unset `EMBEDDING_MODEL` defaults to
`text-embedding-3-small` or `gemini-embedding-001`.

## Lexical search

`document_chunks.search` is a generated `tsvector`: `to_tsvector('simple', content)`, with a GIN
index. `PgVectorStore.searchText` matches it with `websearch_to_tsquery('simple', …)`, which takes
what a person types (quotes and a leading minus included) and never throws on it. Hits are ranked by
`ts_rank`. The hit shape is the same `SearchHit` the semantic path returns, and the goal scope is
applied the same way, on the input set, before anything is ranked.

`simple`, not a language: the corpus has no single language, and a stemmer for the wrong one is
worse than none. The cost is recall: `invoices` does not match `invoice`. That is the trade-off for
needing no key and making no call.

## Switching providers

Every chunk records `embedding_model`. `search` compares only chunks the active model wrote,
because a vector from another model is a point in another space and a distance to it ranks noise.
So after a switch, the old chunks are unread until they are re-embedded:

```bash
pnpm ai:reindex
```

That queues one `reembed` job per organization on the embedding queue. The worker's
`ReembedChunksUseCase` re-embeds, a batch at a time, every chunk whose model is missing or
different. It keeps the stored text rather than re-splitting the source, so chunk boundaries do not
move. With `EMBEDDING_PROVIDER=none` the job does nothing, because lexical search already reads
every chunk. Chunks written before `0002_chunk_embedding_model` have no model and count as stale.

**`EMBEDDING_DIMENSIONS` stays 1536 for both providers.** Changing it means `ALTER TABLE` on the
column plus a re-embed of the whole corpus.

## Trade-offs

| | `none` | `openai` | `gemini` |
|---|---|---|---|
| Outbound calls | none | per index and per search | per index and per search |
| Finds a paraphrase | no | yes | yes |
| Cost | none | per token | per token |
| Query and document embedded differently | — | no | yes |
