import { z } from "../import.js";
import { Identifiers } from "../primitive/index.js";

export class DocumentContract {
  private constructor() {}

  // One retrieved chunk, not a document: what the store holds is chunks, and pretending
  // otherwise would make the score meaningless.
  public static readonly hit = z.object({
    id: z.string().min(1),
    // The document the chunk came from. Several hits can share one.
    sourceId: z.string().min(1),
    content: z.string(),
    // Cosine similarity, 0 to 1. `PgVectorStore` applies a floor, so a hit that reaches
    // a caller has already cleared it.
    score: z.number(),
    metadata: z.record(z.string(), z.unknown()),
  });

  public static readonly index = z.object({
    // Absent for new text; supplied to re-index a document in place, which replaces its
    // chunks rather than adding to them.
    documentId: z.string().min(1).max(200).optional(),
    // Capped, because embedding cost is linear in it and the body is the only bound.
    text: z.string().min(1).max(100_000),
    goalId: Identifiers.goalId.nullable().default(null),
    sourceType: z.string().min(1).max(50).default("document"),
  });

  // Deliberately not the chunks: indexing is queued, so there is nothing to return yet
  // and a shape promising results would be a lie the day it is read.
  public static readonly queued = z.object({ documentId: z.string().min(1) });

  public static readonly search = z.object({
    query: z.string().min(1).max(1_000),
    limit: z.number().int().positive().max(50).default(10),
  });
}

export type DocumentHitDto = z.infer<typeof DocumentContract.hit>;
export type IndexDocumentInput = z.infer<typeof DocumentContract.index>;
export type QueuedDocumentDto = z.infer<typeof DocumentContract.queued>;
export type SearchDocumentsInput = z.infer<typeof DocumentContract.search>;
