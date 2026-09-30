import {
  type DocumentChunk,
  type IndexedSource,
  type OrganizationId,
  type SearchHit,
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
    goalIds: readonly string[],
    limit: number,
  ): Promise<readonly SearchHit[]> {
    const permitted = (this.chunks.get(organizationId) ?? []).filter(
      (chunk) => chunk.goalId === null || goalIds.includes(chunk.goalId),
    );

    const hits = permitted
      .map((chunk) => ({
        id: chunk.id,
        sourceId: chunk.sourceId,
        content: chunk.content,
        score: InMemoryVectorStore.cosine(embedding, chunk.embedding),
        metadata: chunk.metadata,
      }))
      .filter((hit) => hit.score >= MIN_SCORE)
      .sort((left, right) => right.score - left.score)
      .slice(0, limit);

    return Promise.resolve(hits);
  }

  public countFor(organizationId: OrganizationId): number {
    return (this.chunks.get(organizationId) ?? []).length;
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
