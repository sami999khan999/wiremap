import {
  and,
  asc,
  cosineDistance,
  type DocumentChunk,
  eq,
  type IndexedSource,
  inArray,
  isNull,
  lt,
  type OrganizationId,
  or,
  type Placement,
  type SearchHit,
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
          embedding: [...chunk.embedding],
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
    goalIds: readonly string[],
    limit: number,
  ): Promise<readonly SearchHit[]> {
    // The distance, not the similarity. pgvector serves the HNSW index only for an
    // ascending order on the operator itself — see docs/reference/pgvector.md.
    const distance = cosineDistance(documentChunks.embedding, [...embedding]);
    const similarity = sql<number>`1 - (${distance})`;

    // An empty scope means org-wide chunks only, never everything. If it meant "no
    // filter", a bug that fails to compute the permitted set would grant the corpus.
    const scope =
      goalIds.length > 0
        ? or(isNull(documentChunks.goalId), inArray(documentChunks.goalId, [...goalIds]))
        : isNull(documentChunks.goalId);

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
          scope,
          lt(distance, PgVectorStore.MAX_DISTANCE),
        ),
      )
      .orderBy(asc(distance))
      .limit(limit);
  }
}
