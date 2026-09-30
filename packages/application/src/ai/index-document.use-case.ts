import { UnavailableError, Uuid, ValidationError } from "../import.js";
import type { ActivityLogger, EmbeddingProvider, UnitOfWork, VectorStore } from "../port/index.js";
import type { Authorizer, Principal } from "../primitive/index.js";

export interface IndexDocumentInput {
  readonly documentId: string;
  readonly text: string;
  // Null means the document is org-wide within this organization, never across them.
  readonly goalId?: string | null;
  readonly sourceType?: string;
  // The request's time. Absent for a caller that is not racing anything.
  readonly version?: number;
}

export interface IndexDocumentResult {
  readonly documentId: string;
  readonly chunks: number;
}

// Characters, not tokens. A token count needs the model's tokeniser, which is a
// provider concern; this is the coarse bound that keeps a batch inside a request.
const CHUNK_SIZE = 1_500;
const CHUNK_OVERLAP = 200;

// LOAD → AUTHORIZE → WORK → PERSIST. Callable from an oRPC router and from the
// worker's consumer, and the `Authorizer.assert()` below is the gate in both.
export class IndexDocumentUseCase {
  public constructor(
    private readonly authorizer: Authorizer,
    private readonly embeddings: EmbeddingProvider,
    private readonly vectors: VectorStore,
    private readonly activity: ActivityLogger,
    private readonly unitOfWork: UnitOfWork,
  ) {}

  public async execute(actor: Principal, input: IndexDocumentInput): Promise<IndexDocumentResult> {
    this.authorizer.assert(actor, "ai.embedding.write");

    const texts = IndexDocumentUseCase.split(input.text);
    if (texts.length === 0) {
      throw new ValidationError([{ field: "text", rule: "required" }]);
    }

    // Before the paid call. Two edits are two jobs, and a retried older one landing last
    // replaced the newer chunks with stale text (`CR.33`).
    if (await this.superseded(actor, input)) return { documentId: input.documentId, chunks: 0 };

    // One round trip for the whole document. A per-chunk call is what turns a
    // re-index into a rate-limit incident.
    const vectors = await this.embeddings.embed(texts);

    // Before the unit of work, because the write below deletes first: a short response
    // padded with empty vectors deletes the corpus and inserts nothing back.
    if (vectors.length !== texts.length) {
      throw new UnavailableError("embedding.provider");
    }

    const chunks = texts.map((content, index) => ({
      id: Uuid.v7(),
      sourceId: input.documentId,
      goalId: input.goalId ?? null,
      content,
      embedding: vectors[index] as readonly number[],
      metadata: {
        sourceType: input.sourceType ?? "document",
        chunkIndex: index,
        ...(input.version === undefined ? {} : { version: input.version }),
      },
    }));

    // Replace rather than merge, in one transaction: a re-index of shortened text must
    // not leave the chunks it no longer has.
    const replaced = await this.unitOfWork.run(async () => {
      // Again inside, since the embedding took a while and a newer job may have landed.
      if (await this.superseded(actor, input)) return false;
      await this.vectors.deleteBySource(actor.organizationId, input.documentId);
      await this.vectors.upsert(actor.organizationId, chunks);
      await this.activity.record(actor, "ai.document.indexed", {
        documentId: input.documentId,
        chunks: chunks.length,
      });
      return true;
    });

    return { documentId: input.documentId, chunks: replaced ? chunks.length : 0 };
  }

  // Strictly newer only: the same version is this job's own retry, and it may finish.
  private async superseded(actor: Principal, input: IndexDocumentInput): Promise<boolean> {
    if (input.version === undefined) return false;
    const indexed = await this.vectors.sourceOf(actor.organizationId, input.documentId);
    return indexed?.version != null && indexed.version > input.version;
  }

  // Fixed-width windows with an overlap, so a sentence straddling a boundary is
  // retrievable from either side. Not sentence-aware: that is a model's job.
  private static split(text: string): readonly string[] {
    const trimmed = text.trim();
    if (trimmed.length === 0) return [];

    const stride = CHUNK_SIZE - CHUNK_OVERLAP;
    const out: string[] = [];

    for (let start = 0; start < trimmed.length; start += stride) {
      const slice = trimmed.slice(start, start + CHUNK_SIZE).trim();
      if (slice.length > 0) out.push(slice);
      if (start + CHUNK_SIZE >= trimmed.length) break;
    }

    return out;
  }
}
