import type { OrganizationId } from "../import.js";

export interface DocumentChunk {
  readonly id: string;
  readonly sourceId: string;
  readonly goalId: string | null;
  readonly content: string;
  readonly embedding: readonly number[];
  readonly metadata: Readonly<Record<string, unknown>>;
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

  // Null when nothing is indexed under that source. One row, off the source index.
  public abstract sourceOf(
    organizationId: OrganizationId,
    sourceId: string,
  ): Promise<IndexedSource | null>;

  // Required so the permission filter runs on the input set: filtering results means the
  // model already saw what the actor cannot.
  public abstract search(
    organizationId: OrganizationId,
    embedding: readonly number[],
    goalIds: readonly string[],
    limit: number,
  ): Promise<readonly SearchHit[]>;
}
