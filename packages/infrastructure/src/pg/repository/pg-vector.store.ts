import {
  and,
  asc,
  cosineDistance,
  type DocumentChunk,
  desc,
  eq,
  type IndexedSource,
  inArray,
  isNull,
  lt,
  type OrganizationId,
  or,
  type Placement,
  type SearchHit,
  type StaleChunk,
  sql,
  type VectorStore,
} from "../../import.js";
import { BaseRepository } from "../primitive/index.js";
import { documentChunks } from "../schema/index.js";

// `metadata` is an untyped bag, so these two NOT NULL columns are read out of it
// defensively. `String(unknown)` would write "[object Object]" and never throw.
const asText = (value: unknown, fallback: string): string =>
  typeof value === "string" ? value : fallback;

const asInt = (value: unknown, fallback: number): number =>
  typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : fallback;

export class PgVectorStore extends BaseRepository implements VectorStore {
  // `document_chunks` is tenant-produced.
  protected override readonly placement: Placement = "routed";

  // Vector search always returns `limit` rows however bad. Without a floor an
  // unrelated question retrieves the least-unrelated documents in the corpus.
  private static readonly MIN_SCORE = 0.3;

  // The same floor as a distance, because cosine distance is `1 - similarity` and the
  // predicate has to be on the indexed expression rather than on an inversion of it.
  private static readonly MAX_DISTANCE = 1 - PgVectorStore.MIN_SCORE;

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
          sourceType: asText(chunk.metadata.sourceType, "unknown"),
          goalId: chunk.goalId,
          chunkIndex: asInt(chunk.metadata.chunkIndex, 0),
          content: chunk.content,
          embedding: chunk.embedding === null ? null : [...chunk.embedding],
          embeddingModel: chunk.embeddingModel,
          metadata: { ...chunk.metadata },
        })),
      )
      .onConflictDoUpdate({
        // Both key columns: the table is partitioned by tenant, so its primary key is
        // the pair and a conflict target naming only `id` matches no unique index.
        target: [documentChunks.id, documentChunks.organizationId],
        set: {
          content: sql`excluded.content`,
          embedding: sql`excluded.embedding`,
          embeddingModel: sql`excluded.embedding_model`,
          metadata: sql`excluded.metadata`,
        },
      });
  }

  // The tenant predicate is here too. A delete keyed only on a caller-supplied
  // sourceId is a cross-tenant write, and nothing comes back looking wrong.
  public async deleteBySource(organizationId: OrganizationId, sourceId: string): Promise<void> {
    await this.db
      .delete(documentChunks)
      .where(
        and(
          eq(documentChunks.organizationId, organizationId),
          eq(documentChunks.sourceId, sourceId),
        ),
      );
  }

  // Any one chunk answers: every chunk of a source is written in one transaction, with one
  // goal and one version. `document_chunks_source_idx` serves it.
  public async sourceOf(
    organizationId: OrganizationId,
    sourceId: string,
  ): Promise<IndexedSource | null> {
    const [row] = await this.db
      .select({
        goalId: documentChunks.goalId,
        version: sql<string | null>`${documentChunks.metadata} ->> 'version'`,
      })
      .from(documentChunks)
      .where(
        and(
          eq(documentChunks.organizationId, organizationId),
          eq(documentChunks.sourceId, sourceId),
        ),
      )
      .limit(1);

    if (!row) return null;
    return { goalId: row.goalId, version: row.version === null ? null : Number(row.version) };
  }

  public async search(
    organizationId: OrganizationId,
    embedding: readonly number[],
    model: string,
    goalIds: readonly string[],
    limit: number,
  ): Promise<readonly SearchHit[]> {
    // The distance, not the similarity. pgvector serves the HNSW index only for an
    // ascending order on the operator itself — see docs/reference/pgvector.md.
    const distance = cosineDistance(documentChunks.embedding, [...embedding]);
    const similarity = sql<number>`1 - (${distance})`;

    return this.db
      .select({
        id: documentChunks.id,
        sourceId: documentChunks.sourceId,
        content: documentChunks.content,
        score: similarity,
        metadata: documentChunks.metadata,
      })
      .from(documentChunks)
      .where(
        and(
          eq(documentChunks.organizationId, organizationId),
          PgVectorStore.scope(goalIds),
          // Another model's vector is a point in another space, and a distance to it
          // would rank noise. After a switch those chunks wait for `ai:reindex`.
          eq(documentChunks.embeddingModel, model),
          lt(distance, PgVectorStore.MAX_DISTANCE),
        ),
      )
      .orderBy(asc(distance))
      .limit(limit);
  }

  // `websearch_to_tsquery`, not `to_tsquery`: it takes what a person types, quotes and a
  // leading minus included, and never throws on it. `simple`, matching the column.
  public async searchText(
    organizationId: OrganizationId,
    query: string,
    goalIds: readonly string[],
    limit: number,
  ): Promise<readonly SearchHit[]> {
    const tsquery = sql`websearch_to_tsquery('simple', ${query})`;
    const rank = sql<number>`ts_rank(${documentChunks.search}, ${tsquery})`;

    return this.db
      .select({
        id: documentChunks.id,
        sourceId: documentChunks.sourceId,
        content: documentChunks.content,
        score: rank,
        metadata: documentChunks.metadata,
      })
      .from(documentChunks)
      .where(
        and(
          eq(documentChunks.organizationId, organizationId),
          PgVectorStore.scope(goalIds),
          sql`${documentChunks.search} @@ ${tsquery}`,
        ),
      )
      .orderBy(desc(rank), asc(documentChunks.id))
      .limit(limit);
  }

  // Missing or another model's, which is every chunk a switch left behind.
  public async stale(
    organizationId: OrganizationId,
    model: string,
    limit: number,
  ): Promise<readonly StaleChunk[]> {
    return this.db
      .select({ id: documentChunks.id, content: documentChunks.content })
      .from(documentChunks)
      .where(
        and(
          eq(documentChunks.organizationId, organizationId),
          sql`${documentChunks.embeddingModel} is distinct from ${model}`,
        ),
      )
      .orderBy(asc(documentChunks.createdAt), asc(documentChunks.id))
      .limit(limit);
  }

  public async saveEmbeddings(
    organizationId: OrganizationId,
    embeddings: readonly { readonly id: string; readonly embedding: readonly number[] }[],
    model: string,
  ): Promise<void> {
    for (const entry of embeddings) {
      await this.db
        .update(documentChunks)
        .set({ embedding: [...entry.embedding], embeddingModel: model })
        .where(
          and(eq(documentChunks.organizationId, organizationId), eq(documentChunks.id, entry.id)),
        );
    }
  }

  // An empty scope means org-wide chunks only, never everything. If it meant "no
  // filter", a bug that fails to compute the permitted set would grant the corpus.
  private static scope(goalIds: readonly string[]) {
    return goalIds.length > 0
      ? or(isNull(documentChunks.goalId), inArray(documentChunks.goalId, [...goalIds]))
      : isNull(documentChunks.goalId);
  }
}
