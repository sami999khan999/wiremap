// What the text is for. Gemini embeds a query and a document differently and is told
// which; OpenAI embeds both the same way and ignores it.
export type EmbeddingPurpose = "document" | "query";

export abstract class EmbeddingProvider {
  public abstract readonly dimensions: number;

  // Recorded on every chunk it embeds, so vectors from two models are never compared.
  public abstract readonly model: string;

  // Batched by construction: a single-string signature is what turns a re-index into a
  // thousand requests.
  public abstract embed(
    texts: readonly string[],
    purpose?: EmbeddingPurpose,
  ): Promise<readonly (readonly number[])[]>;
}
