import { EmbeddingProvider } from "../import.js";

// Deterministic vectors derived from the text, never a network call. Same text in,
// same vector out — which is what lets a retrieval test assert an ordering at all.
export class StubEmbeddingProvider extends EmbeddingProvider {
  public override readonly dimensions: number;
  public override readonly model = "stub-embedding";

  public constructor(dimensions = 8) {
    super();
    this.dimensions = dimensions;
  }

  public override embed(texts: readonly string[]): Promise<readonly (readonly number[])[]> {
    return Promise.resolve(texts.map((text) => this.vectorFor(text)));
  }

  // A character-code histogram folded into `dimensions` buckets. Not semantic, and it
  // does not need to be: it is stable, and similar strings land near each other.
  private vectorFor(text: string): readonly number[] {
    const vector = new Array<number>(this.dimensions).fill(0);
    for (let i = 0; i < text.length; i += 1) {
      const bucket = text.charCodeAt(i) % this.dimensions;
      vector[bucket] = (vector[bucket] ?? 0) + 1;
    }
    return vector;
  }
}
