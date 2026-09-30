import {
  type DocumentChunk,
  type IndexedSource,
  type OrganizationId,
  type SearchHit,
  type StaleChunk,
  VectorStore,
} from "../import.js";

// The same floor `PgVectorStore` applies. Without it a fake returns the least-unrelated
// chunk where the adapter returns nothing, and the caller's empty branch never runs.
const MIN_SCORE = 0.3;

// Cosine is computed for real: scoring every hit the same makes "the top result is the
// right one" pass either way, which is the assertion worth having.
export class InMemoryVectorStore extends VectorStore {
  private readonly chunks = new Map<string, DocumentChunk[]>();

  public override upsert(
    organizationId: OrganizationId,
    chunks: readonly DocumentChunk[],
  ): Promise<void> {
    const existing = this.chunks.get(organizationId) ?? [];
    const incoming = new Set(chunks.map((chunk) => chunk.id));
    this.chunks.set(organizationId, [
      ...existing.filter((chunk) => !incoming.has(chunk.id)),
      ...chunks,
    ]);
    return Promise.resolve();
  }

  public override deleteBySource(organizationId: OrganizationId, sourceId: string): Promise<void> {
    const existing = this.chunks.get(organizationId) ?? [];
    this.chunks.set(
      organizationId,
      existing.filter((chunk) => chunk.sourceId !== sourceId),
    );
    return Promise.resolve();
  }

  public override sourceOf(
    organizationId: OrganizationId,
    sourceId: string,
  ): Promise<IndexedSource | null> {
    const chunk = (this.chunks.get(organizationId) ?? []).find((c) => c.sourceId === sourceId);
    if (!chunk) return Promise.resolve(null);
    const version = chunk.metadata.version;
    return Promise.resolve({
      goalId: chunk.goalId,
      version: typeof version === "number" ? version : null,
    });
  }

  // Filters the input set before scoring, like the real store: filtering after retrieval
  // means the model already saw what the actor cannot.
  public override search(
    organizationId: OrganizationId,
    embedding: readonly number[],
    model: string,
    goalIds: readonly string[],
    limit: number,
  ): Promise<readonly SearchHit[]> {
    // Only `model`'s vectors, like the real store: another model's are another space.
    const permitted = this.permitted(organizationId, goalIds).filter(
      (chunk) => chunk.embedding !== null && chunk.embeddingModel === model,
    );

    const hits = permitted
      .map((chunk) => ({
        id: chunk.id,
        sourceId: chunk.sourceId,
        content: chunk.content,
        score: InMemoryVectorStore.cosine(embedding, chunk.embedding ?? []),
        metadata: chunk.metadata,
      }))
      .filter((hit) => hit.score >= MIN_SCORE)
      .sort((left, right) => right.score - left.score)
      .slice(0, limit);

    return Promise.resolve(hits);
  }

  // Word overlap stands in for `ts_rank`: a chunk scores by how many of the query's words
  // it holds, and one holding none is not a hit, as `@@` would not match it.
  public override searchText(
    organizationId: OrganizationId,
    query: string,
    goalIds: readonly string[],
    limit: number,
  ): Promise<readonly SearchHit[]> {
    const words = InMemoryVectorStore.words(query);
    const hits = this.permitted(organizationId, goalIds)
      .map((chunk) => {
        const held = new Set(InMemoryVectorStore.words(chunk.content));
        return {
          id: chunk.id,
          sourceId: chunk.sourceId,
          content: chunk.content,
          score: words.filter((word) => held.has(word)).length,
          metadata: chunk.metadata,
        };
      })
      .filter((hit) => hit.score > 0)
      .sort((left, right) => right.score - left.score)
      .slice(0, limit);
    return Promise.resolve(hits);
  }

  public override stale(
    organizationId: OrganizationId,
    model: string,
    limit: number,
  ): Promise<readonly StaleChunk[]> {
    return Promise.resolve(
      (this.chunks.get(organizationId) ?? [])
        .filter((chunk) => chunk.embeddingModel !== model)
        .slice(0, limit)
        .map((chunk) => ({ id: chunk.id, content: chunk.content })),
    );
  }

  public override saveEmbeddings(
    organizationId: OrganizationId,
    embeddings: readonly { readonly id: string; readonly embedding: readonly number[] }[],
    model: string,
  ): Promise<void> {
    const byId = new Map(embeddings.map((entry) => [entry.id, entry.embedding]));
    this.chunks.set(
      organizationId,
      (this.chunks.get(organizationId) ?? []).map((chunk) => {
        const embedding = byId.get(chunk.id);
        return embedding ? { ...chunk, embedding, embeddingModel: model } : chunk;
      }),
    );
    return Promise.resolve();
  }

  public countFor(organizationId: OrganizationId): number {
    return (this.chunks.get(organizationId) ?? []).length;
  }

  // The input set, before any scoring: filtering afterwards means the ranking already saw
  // what the actor cannot.
  private permitted(organizationId: OrganizationId, goalIds: readonly string[]) {
    return (this.chunks.get(organizationId) ?? []).filter(
      (chunk) => chunk.goalId === null || goalIds.includes(chunk.goalId),
    );
  }

  private static words(text: string): readonly string[] {
    return text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((word) => word.length > 0);
  }

  private static cosine(left: readonly number[], right: readonly number[]): number {
    let dot = 0;
    let leftNorm = 0;
    let rightNorm = 0;

    for (let i = 0; i < left.length; i += 1) {
      const a = left[i] ?? 0;
      const b = right[i] ?? 0;
      dot += a * b;
      leftNorm += a * a;
      rightNorm += b * b;
    }

    const magnitude = Math.sqrt(leftNorm) * Math.sqrt(rightNorm);
    return magnitude === 0 ? 0 : dot / magnitude;
  }
}
