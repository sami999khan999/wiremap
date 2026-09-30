export abstract class EmbeddingProvider {
  public abstract readonly dimensions: number;

  // Batched by construction: a single-string signature is what turns a re-index into a
  // thousand requests.
  public abstract embed(texts: readonly string[]): Promise<readonly (readonly number[])[]>;
}
