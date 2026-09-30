# 14 · Vector Storage

> pgvector today, a dedicated vector database later, with no rewrite in between. The seam, the schema, and the four rules that keep the swap cheap.

**Delivers:** `PgVectorStore` implementing the `VectorStore` port, an `EmbeddingProvider`, and a migration path to a dedicated vector database that is one new folder, one `case`, and one environment variable.

**Prerequisite:** [13 · `@loadbearing/infrastructure` — the Postgres side](13-infrastructure-postgres.md)

---

## The seam, restated

`VectorStore` and `EmbeddingProvider` are abstract classes in `packages/application/src/port/`
([12](12-application-package.md)). Concrete implementations live in `packages/infrastructure/src/`,
one folder per external system. Use-cases depend only on the abstractions.

```
VectorStore (abstract)              packages/application/src/port/vector.store.ts
    ├── PgVectorStore               infrastructure/src/pg/repository/pg-vector.store.ts   ← today
    ├── <Vendor>VectorStore         infrastructure/src/<vendor>/…                         ← later
    └── InMemoryVectorStore         composition/src/fake/

EmbeddingProvider (abstract)        packages/application/src/port/embedding.provider.ts
    ├── OpenAiEmbeddingProvider     infrastructure/src/openai/openai-embedding.provider.ts
    └── StubEmbeddingProvider       composition/src/fake/
```

> **Why the port is not beside the Postgres implementation.** The architecture docs put `VectorStore`
> in the database package. That is fine while the implementation is Postgres and stops being fine the
> moment it is not: `application` cannot import `infrastructure`, so a use-case could not name the
> type. Moving the abstraction to `port/` is the change that makes the stated requirement — swap to a
> dedicated vector DB without rewrites — actually true. `PgVectorStore` stays in `pg/repository/`
> because it is Drizzle code operating on a Postgres table.

### The folder is the vendor, and that is what makes room for the next one

A dedicated vector database is **a sibling folder to `pg/`, never a subfolder of it.**
`infrastructure/src/qdrant/qdrant.vector-store.ts` sits beside `infrastructure/src/clickhouse/` and
`infrastructure/src/loki/`, each named for the system it speaks to.

That is not filing preference. `pg/vector/` — which is where `PgVectorStore` used to live — would put
a second implementation in an awkward place: either nested under Postgres, which it has nothing to do
with, or in a top-level `vector/` that names the *subject* while every neighbour names the
*technology*. ClickHouse is the case that forced the question, since `pg/analytics/` and
`clickhouse/` were the same collision one port over. **One axis: the external system.**

---

## Step 14.1 — The schema

**`packages/infrastructure/src/pg/schema/vector.schema.ts`**

```ts
import { sql } from "drizzle-orm";
import { index, jsonb, pgTable, text, timestamp, uuid, vector } from "drizzle-orm/pg-core";

export const documentChunks = pgTable(
  "document_chunks",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id").notNull(),

    // The domain row this chunk was derived from — a document, receipt, note.
    sourceId: uuid("source_id").notNull(),
    sourceType: text("source_type").notNull(),

    // Null means org-wide *within this organization*, never across organizations.
    goalId: uuid("goal_id"),

    chunkIndex: text("chunk_index").notNull(),
    content: text("content").notNull(),

    // Dimensions must match EMBEDDING_DIMENSIONS. Changing it is a migration.
    embedding: vector("embedding", { dimensions: 1536 }).notNull(),

    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("document_chunks_source_idx").on(t.organizationId, t.sourceId),
    index("document_chunks_goal_idx").on(t.organizationId, t.goalId),
    index("document_chunks_embedding_idx")
      .using("hnsw", t.embedding.op("vector_cosine_ops"))
      .with({ m: 16, ef_construction: 64 }),
  ],
);

export const documentChunksGoalNullIdx = sql`
  CREATE INDEX IF NOT EXISTS document_chunks_goal_null_idx
  ON document_chunks (organization_id, id) WHERE goal_id IS NULL
`;
```

### Five decisions in that table

**`goalId` is a real column, indexed, and part of every query.** Not metadata inside the JSONB blob. The permission filter runs as a `WHERE` clause on an indexed column, before the vector comparison, so the index can actually be used. Burying the scope in JSON means filtering after retrieval, which is the thing [12](12-application-package.md) exists to prevent.

**`organizationId` is a real column for the same reason, and it is the more dangerous of the two.** A missing `goalId` predicate over-retrieves within one customer's data; a missing `organizationId` predicate retrieves *another customer's* data. Both indexes lead with it, and every query below carries it.

The subtlety worth naming: `goal_id IS NULL` means "visible to everyone in this organization". Without a tenant predicate alongside it, that same condition means "visible to everyone, everywhere" — and it would read as correct in review, because the code says `isNull(goalId)` in both cases. This is exactly the shape of bug the branded `OrganizationId` in [10](10-contracts-package.md) exists to make hard to write.

**HNSW rather than IVFFlat.** IVFFlat needs training data to build a useful index, so it performs badly until the table is populated and needs rebuilding as the distribution shifts. HNSW builds incrementally, which matters when the table starts empty and grows continuously. It costs more memory and more insert time; both are the right trade here.

`m: 16, ef_construction: 64` are the pgvector defaults and are correct until you have measured otherwise. Tuning them before you have a corpus is guessing.

**Cosine distance (`vector_cosine_ops`).** OpenAI embeddings are normalised, so cosine and inner product rank identically, but cosine is what every provider documents and what every tutorial assumes. Matching the index operator class to the query operator is mandatory — a mismatch silently falls back to a sequential scan, and the only symptom is that search gets slow as the table grows.

**Dimensions are fixed at the column type.** `text-embedding-3-small` is 1536. Changing the model to one with different dimensions is `ALTER TABLE` plus re-embedding the entire corpus. That is why `EMBEDDING_DIMENSIONS` is in `.env.example` from [02](02-repo-skeleton.md) — the value is a decision, and decisions should be visible.

---

## Step 14.2 — `PgVectorStore`

**`packages/infrastructure/src/pg/repository/pg-vector.store.ts`**

```ts
import { and, cosineDistance, desc, eq, gt, inArray, isNull, or, sql } from "drizzle-orm";
import {
  VectorStore,
  type DocumentChunk,
  type SearchHit,
} from "@loadbearing/application";
import type { OrganizationId } from "@loadbearing/contracts";
import { BaseRepository } from "../base.repository.js";
import { documentChunks } from "./vector.schema.js";

export class PgVectorStore extends BaseRepository implements VectorStore {
  private static readonly MIN_SCORE = 0.3;

  public async upsert(
    organizationId: OrganizationId,
    chunks: readonly DocumentChunk[],
  ): Promise<void> {
    if (chunks.length === 0) return;

    await this.db
      .insert(documentChunks)
      .values(
        chunks.map((chunk) => ({
          id: chunk.id,
          organizationId,
          sourceId: chunk.sourceId,
          sourceType: String(chunk.metadata.sourceType ?? "unknown"),
          goalId: chunk.goalId,
          chunkIndex: String(chunk.metadata.chunkIndex ?? 0),
          content: chunk.content,
          embedding: [...chunk.embedding],
          metadata: chunk.metadata as Record<string, unknown>,
        })),
      )
      .onConflictDoUpdate({
        target: documentChunks.id,
        set: {
          content: sql`excluded.content`,
          embedding: sql`excluded.embedding`,
          metadata: sql`excluded.metadata`,
        },
      });
  }

  public async deleteBySource(
    organizationId: OrganizationId,
    sourceId: string,
  ): Promise<void> {
    await this.db
      .delete(documentChunks)
      .where(
        and(
          eq(documentChunks.organizationId, organizationId),
          eq(documentChunks.sourceId, sourceId),
        ),
      );
  }

  public async search(
    organizationId: OrganizationId,
    embedding: readonly number[],
    goalIds: readonly string[],
    limit: number,
  ): Promise<readonly SearchHit[]> {
    const similarity = sql<number>`1 - (${cosineDistance(documentChunks.embedding, [...embedding])})`;

    // Permission scope, applied as a WHERE clause — before retrieval, not after.
    const scope =
      goalIds.length > 0
        ? or(isNull(documentChunks.goalId), inArray(documentChunks.goalId, [...goalIds]))
        : isNull(documentChunks.goalId);

    const rows = await this.db
      .select({
        id: documentChunks.id,
        sourceId: documentChunks.sourceId,
        content: documentChunks.content,
        metadata: documentChunks.metadata,
        score: similarity,
      })
      .from(documentChunks)
      .where(
        and(
          eq(documentChunks.organizationId, organizationId),
          scope,
          gt(similarity, PgVectorStore.MIN_SCORE),
        ),
      )
      .orderBy((t) => desc(t.score))
      .limit(limit);

    return rows.map((row) => ({
      id: row.id,
      sourceId: row.sourceId,
      content: row.content,
      score: row.score,
      metadata: row.metadata,
    }));
  }
}
```

**`goalIds` empty means org-wide chunks only, never everything.** That default is the one that matters. If an empty scope meant "no filter," a bug that fails to compute the permitted set would silently grant access to the whole corpus — and it would look like it was working.

**`organizationId` is what makes "org-wide" mean anything.** It is a separate predicate on every one of these three methods, and it is deliberately not folded into `scope`: the tenant filter is not a permission decision that a `CapabilitySet` computes, it is the boundary inside which permissions are computed at all. A caller cannot opt out of it, because there is no code path where it is optional.

Note that `deleteBySource` takes it too. A delete keyed only on a caller-supplied `sourceId` is a cross-tenant write, and it is easier to miss than a read because nothing comes back looking wrong.

**A minimum score threshold.** Vector search always returns `limit` results, however bad. Without a floor, an unrelated question retrieves the least-unrelated documents in the corpus and the model confidently summarises them. `0.3` is a starting point to tune against your own data, not a universal constant.

**No Drizzle `vector` helper may be imported outside this folder.** That is the rule that keeps the swap cheap: if `cosineDistance` appears in a use-case, moving to Qdrant means rewriting the use-case.

---

## Step 14.3 — The embedding provider

**`packages/infrastructure/src/openai/openai-embedding.provider.ts`**

```ts
import { EmbeddingProvider } from "@loadbearing/application";

export interface OpenAiEmbeddingConfig {
  readonly apiKey: string;
  readonly model: string;
  readonly dimensions: number;
  readonly endpoint?: string;
}

export class OpenAiEmbeddingProvider extends EmbeddingProvider {
  private static readonly MAX_BATCH = 96;

  public override readonly dimensions: number;

  constructor(private readonly config: OpenAiEmbeddingConfig) {
    super();
    this.dimensions = config.dimensions;
  }

  public override async embed(texts: readonly string[]): Promise<readonly (readonly number[])[]> {
    const out: (readonly number[])[] = [];

    for (let i = 0; i < texts.length; i += OpenAiEmbeddingProvider.MAX_BATCH) {
      const batch = texts.slice(i, i + OpenAiEmbeddingProvider.MAX_BATCH);
      const response = await fetch(
        `${this.config.endpoint ?? "https://api.openai.com/v1"}/embeddings`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${this.config.apiKey}`,
          },
          body: JSON.stringify({
            model: this.config.model,
            dimensions: this.config.dimensions,
            input: batch,
          }),
        },
      );

      if (!response.ok) {
        throw new Error(`Embedding request failed: ${response.status} ${await response.text()}`);
      }

      const body = (await response.json()) as { data: { index: number; embedding: number[] }[] };
      for (const item of [...body.data].sort((a, b) => a.index - b.index)) {
        out.push(item.embedding);
      }
    }

    return out;
  }
}
```

**Sort by `index` before collecting.** Batch embedding endpoints do not guarantee response order, and a silently shuffled batch produces embeddings attached to the wrong text — a bug that never throws and makes search subtly wrong forever.

**`fetch` rather than the OpenAI SDK.** One dependency fewer, and the request shape is stable and documented. If you later want the SDK's retry behaviour, that is a change inside this one class.

**Embedding happens in the worker, not in a request.** A hundred chunks is a hundred network calls' worth of latency; it belongs behind `QueuePublisher`. See [25](25-worker-app.md).

---

## Step 14.4 — Migration to a dedicated vector database

The whole design exists for this moment. When pgvector stops being enough — typically somewhere past
a few million chunks, or when you want managed filtering and hybrid search — here is the complete
change:

**1.** Write `<Vendor>VectorStore implements VectorStore` in a **new sibling folder**,
`packages/infrastructure/src/<vendor>/`. Three methods. It sits beside `pg/`, `clickhouse/` and
`loki/`, named for the system it speaks to.

**2.** Add the driver to the union and to the switch. Two lines, in two files:

```ts
// packages/composition/src/container/container.config.ts
readonly vector: { readonly driver: "pgvector" | "<vendor>" };
```

```ts
// packages/composition/src/container/container.ts
switch (config.vector.driver) {
  case "pgvector":  return new PgVectorStore(database, transactions);
  case "<vendor>":  return new VendorVectorStore(config.vector.connection);
  default: {
    const unreachable: never = config.vector.driver;
    throw new Error(`Unknown vector driver: ${String(unreachable)}`);
  }
}
```

The `never` default is why this is two lines and not a hunt: adding the driver to the union without
adding the `case` is a **build error**, not a runtime surprise in whichever environment flipped the
variable first.

**3.** Set `VECTOR_DRIVER=<vendor>` in the environment. Nothing is rebuilt and no call site moves.

**4.** Backfill: read `document_chunks` in pages, write to the new store, verify counts. Or re-embed
from source documents — embeddings are derived, which is the property that makes this safe.

**5.** Drop the table and the HNSW index in a later migration, once you are confident.

Nothing in `application`, `contracts`, `permissions`, or any use-case changes. No React changes. The
worker's embedding consumer changes not at all, because it publishes chunks to a `VectorStore` and
never knew which one.

> [!NOTE]
> **`VECTOR_DRIVER` has exactly one legal value today, and it exists anyway.** A seam with one
> implementation is untested by construction — abstract types prove nobody calls a Postgres-specific
> method, but they do not prove a second implementation could be dropped in, because nothing has
> tried. Writing the choice as a discriminated union means step 2 above is a compiler-checked edit
> rather than a search for every `new PgVectorStore`.
>
> `VECTOR_DRIVER` is the only read driver the kit still ships. There used to be a second,
> `ANALYTICS_DRIVER`, with both implementations written — and it was deleted along with the port it
> switched, because nothing ever read through it ([12](12-application-package.md)). The difference
> is not the mechanism; it is that `VectorStore.search()` has a caller.

### Four rules that keep it that cheap

1. **No `vector` column helpers, no `cosineDistance`, no vendor client outside the implementing class.** Grep for them in CI if you want certainty.
2. **`search()` keeps its exact signature.** Adding a Postgres-specific option — a partial index hint, a `tsvector` join — to the port means the port now describes Postgres.
3. **Chunk IDs are generated by you (`Uuid.v7()`), not by the store.** A store that assigns its own IDs makes migration a re-keying exercise.
4. **The permission filter stays a parameter.** Every vector database expresses filtering differently; keeping it as `goalIds: readonly string[]` in the signature means each adapter translates it and no caller learns any of their dialects.

### Hybrid search, when it comes

Semantic search alone misses exact matches — invoice numbers, names, error codes. The eventual answer is hybrid: vector similarity plus full-text, fused by reciprocal rank. `pg_trgm` is already enabled from [11](11-local-infrastructure.md), so the Postgres version of this is a second query and a merge inside `PgVectorStore`.

Do it there, behind the existing `search()`, rather than adding a `searchHybrid()` to the port. The port describes *what the domain needs* — relevant chunks the actor may see — not which retrieval strategies exist.

---

## ✅ Gate

```bash
pnpm db:generate && pnpm db:migrate
```

```bash
docker compose -f infra/docker-compose.yml exec postgres psql -U ratchet -d ratchet \
  -c "\d document_chunks"
```

- The `embedding` column is `vector(1536)`.
- `document_chunks_embedding_idx` exists and is `hnsw`.
- `grep -rn "cosineDistance\|drizzle-orm/pg-core.*vector" packages --include=*.ts` matches only `packages/infrastructure/src/pg/`.

Do not proceed until this passes.

---

[← `@loadbearing/infrastructure` — Postgres](13-infrastructure-postgres.md) · [`@loadbearing/infrastructure` — the rest →](15-infrastructure-package.md)
