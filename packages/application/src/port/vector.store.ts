import type { OrganizationId } from "../import.js";

export interface DocumentChunk {
  readonly id: string;
  readonly sourceId: string;
  readonly goalId: string | null;
  readonly content: string;
  // Null when the deployment runs no provider: the chunk is still searchable by text.
  readonly embedding: readonly number[] | null;
  // The model that wrote `embedding`, null with it. A search reads only its own model's.
  readonly embeddingModel: string | null;
  readonly metadata: Readonly<Record<string, unknown>>;
}

// A chunk whose vector is not the active model's, for the re-embed pass.
export interface StaleChunk {
  readonly id: string;
  readonly content: string;
}

export interface SearchHit {
  readonly id: string;
  readonly sourceId: string;
  readonly content: string;
  readonly score: number;
  readonly metadata: Readonly<Record<string, unknown>>;
}

// What is already indexed for one source: where it sits, and which request wrote it.
// `version` is null for chunks written before versions existed.
export interface IndexedSource {
  readonly goalId: string | null;
  readonly version: number | null;
}

export abstract class VectorStore {
  public abstract upsert(
    organizationId: OrganizationId,
    chunks: readonly DocumentChunk[],
  ): Promise<void>;

  public abstract deleteBySource(organizationId: OrganizationId, sourceId: string): Promise<void>;

  // Null when nothing is indexed under that source. One row, off the source index.
  public abstract sourceOf(
    organizationId: OrganizationId,
    sourceId: string,
  ): Promise<IndexedSource | null>;

  // Required so the permission filter runs on the input set: filtering results means the
  // model already saw what the actor cannot. Only chunks `model` wrote are compared.
  public abstract search(
    organizationId: OrganizationId,
    embedding: readonly number[],
    model: string,
    goalIds: readonly string[],
    limit: number,
  ): Promise<readonly SearchHit[]>;

  // The same shape and the same scope rule, ranked by Postgres full-text search over the
  // chunk text. What `EMBEDDING_PROVIDER=none` searches with, and it calls nobody.
  public abstract searchText(
    organizationId: OrganizationId,
    query: string,
    goalIds: readonly string[],
    limit: number,
  ): Promise<readonly SearchHit[]>;

  // Up to `limit` chunks whose vector is missing or another model's, oldest first.
  public abstract stale(
    organizationId: OrganizationId,
    model: string,
    limit: number,
  ): Promise<readonly StaleChunk[]>;

  // New vectors for existing chunks, all written by `model`. The text is not touched.
  public abstract saveEmbeddings(
    organizationId: OrganizationId,
    embeddings: readonly { readonly id: string; readonly embedding: readonly number[] }[],
    model: string,
  ): Promise<void>;
}
