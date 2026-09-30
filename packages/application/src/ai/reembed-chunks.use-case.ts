import type { UnitOfWork, VectorStore } from "../port/index.js";
import type { Authorizer, Principal } from "../primitive/index.js";
import type { SearchMode } from "./ai-search-mode.js";

export interface ReembedChunksResult {
  readonly chunks: number;
}

// Re-embeds every chunk the active model did not write, a batch at a time, after the
// provider changes. The text is kept as it is: re-splitting would move chunk boundaries.
export class ReembedChunksUseCase {
  // One provider call's worth, and one transaction's.
  private static readonly BATCH = 96;

  public constructor(
    private readonly authorizer: Authorizer,
    private readonly mode: SearchMode,
    private readonly vectors: VectorStore,
    private readonly unitOfWork: UnitOfWork,
  ) {}

  public async execute(actor: Principal): Promise<ReembedChunksResult> {
    this.authorizer.assert(actor, "ai.embedding.write");
    // Nothing to write with: lexical search reads the text, which every chunk already has.
    if (this.mode.kind === "lexical") return { chunks: 0 };

    const { provider } = this.mode;
    let total = 0;

    for (;;) {
      const stale = await this.vectors.stale(
        actor.organizationId,
        provider.model,
        ReembedChunksUseCase.BATCH,
      );
      if (stale.length === 0) return { chunks: total };

      const vectors = await provider.embed(
        stale.map((chunk) => chunk.content),
        "document",
      );
      // A short answer would leave chunks stale and loop on them forever.
      if (vectors.length !== stale.length) return { chunks: total };

      await this.unitOfWork.run(() =>
        this.vectors.saveEmbeddings(
          actor.organizationId,
          stale.map((chunk, index) => ({
            id: chunk.id,
            embedding: vectors[index] as readonly number[],
          })),
          provider.model,
        ),
      );
      total += stale.length;
    }
  }
}
