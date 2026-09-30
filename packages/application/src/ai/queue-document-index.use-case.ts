import { type Clock, Uuid, ValidationError } from "../import.js";
import type { QueuePublisher, VectorStore } from "../port/index.js";
import { type Authorizer, JobKey, type Principal, QueueName } from "../primitive/index.js";

export interface QueueDocumentIndexInput {
  // Optional: a caller re-indexing an existing document supplies its id, and a caller
  // pasting new text does not.
  readonly documentId?: string;
  readonly text: string;
  readonly goalId?: string | null;
  readonly sourceType?: string;
}

export interface QueuedDocumentIndex {
  readonly documentId: string;
}

// Embedding is a network round trip per document and is rate-limited by the provider,
// so the request enqueues and returns rather than holding a connection open for it.
export class QueueDocumentIndexUseCase {
  public constructor(
    private readonly authorizer: Authorizer,
    private readonly queue: QueuePublisher,
    private readonly vectors: VectorStore,
    private readonly clock: Clock,
  ) {}

  public async execute(
    actor: Principal,
    input: QueueDocumentIndexInput,
  ): Promise<QueuedDocumentIndex> {
    // The same key `IndexDocumentUseCase` asserts when the consumer runs it. Checked
    // here too: a job that will be refused should never reach the queue.
    // ──
    // For the goal it is going into, and below for the goal it is in now: a writer could
    // replace any document in the tenant by id, goals they cannot read included (`CR.8`).
    this.authorizer.assert(actor, "ai.embedding.write", input.goalId ?? undefined);

    if (input.text.trim().length === 0) {
      throw new ValidationError([{ field: "text", rule: "required" }]);
    }

    const documentId = input.documentId ?? Uuid.v7();
    if (input.documentId !== undefined) {
      const indexed = await this.vectors.sourceOf(actor.organizationId, input.documentId);
      if (indexed?.goalId) this.authorizer.assert(actor, "ai.embedding.write", indexed.goalId);
    }

    await this.queue.publish(
      QueueName.EMBEDDING,
      {
        organizationId: actor.organizationId,
        documentId,
        text: input.text,
        goalId: input.goalId ?? null,
        sourceType: input.sourceType ?? "document",
        // When the request was made, so a retried older job landing after a newer one
        // is skipped rather than serving the stale text (`CR.33`).
        version: this.clock.now().getTime(),
      },
      // Keyed on the tenant *and* the document: two organizations re-indexing documents
      // that happen to share an id must not collapse into one job. `_`, never `:`.
      // ──
      // The id is the caller's and BullMQ refuses a `:` in one, so `doc:1` was a 500.
      // ──
      // The text is in the key too: a re-index with new words returned success and
      // enqueued nothing, because the completed job still held the id.
      { jobId: `${actor.organizationId}_${JobKey.of(documentId, input.text)}` },
    );

    return { documentId };
  }
}
