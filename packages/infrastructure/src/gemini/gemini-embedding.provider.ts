import {
  EmbeddingProvider,
  type EmbeddingPurpose,
  type Logger,
  UnavailableError,
} from "../import.js";

export interface GeminiEmbeddingConfig {
  readonly apiKey: string;
  readonly model: string;
  // Sent as `outputDimensionality`, so the vectors fit the column OpenAI's do.
  readonly dimensions: number;
  readonly endpoint?: string;
  readonly timeoutMs?: number;
}

interface BatchResponse {
  readonly embeddings?: readonly { readonly values: number[] }[];
}

// Gemini's embeddings over REST, with `fetch` like the OpenAI adapter: no SDK, so no
// new catalog entry. See docs/reference/embedding.md.
export class GeminiEmbeddingProvider extends EmbeddingProvider {
  // The endpoint's own cap on requests per `batchEmbedContents` call.
  private static readonly MAX_BATCH = 100;

  private static readonly DEFAULT_TIMEOUT_MS = 20_000;

  private static readonly TASK: Readonly<Record<EmbeddingPurpose, string>> = {
    document: "RETRIEVAL_DOCUMENT",
    query: "RETRIEVAL_QUERY",
  };

  public override readonly dimensions: number;
  public override readonly model: string;

  public constructor(
    private readonly config: GeminiEmbeddingConfig,
    private readonly logger?: Logger,
  ) {
    super();
    this.dimensions = config.dimensions;
    this.model = config.model;
  }

  // A document unless told otherwise: every caller that forgets is an indexing path.
  public override async embed(
    texts: readonly string[],
    purpose: EmbeddingPurpose = "document",
  ): Promise<readonly (readonly number[])[]> {
    const out: (readonly number[])[] = [];

    for (let i = 0; i < texts.length; i += GeminiEmbeddingProvider.MAX_BATCH) {
      const batch = texts.slice(i, i + GeminiEmbeddingProvider.MAX_BATCH);
      const response = await this.request(batch, purpose);

      // UNAVAILABLE, like the OpenAI adapter: retryable, so a blip is not a dead letter.
      if (!response.ok) {
        this.fail(batch.length);
        throw new UnavailableError("gemini.embeddings", response.status);
      }

      // In request order, one per request: the endpoint has no index field to sort by, so
      // a count that disagrees is the only misalignment that can be caught.
      const body = (await response.json()) as BatchResponse;
      const embeddings = body.embeddings ?? [];
      if (embeddings.length !== batch.length) {
        this.fail(batch.length);
        throw new UnavailableError("gemini.embeddings", response.status);
      }

      for (const embedding of embeddings) out.push(embedding.values);
    }

    return out;
  }

  // The key in a header rather than the query string, so it never lands in an access log.
  private async request(batch: readonly string[], purpose: EmbeddingPurpose): Promise<Response> {
    const base = this.config.endpoint ?? "https://generativelanguage.googleapis.com/v1beta";
    const model = `models/${this.config.model}`;

    try {
      return await fetch(`${base}/${model}:batchEmbedContents`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": this.config.apiKey },
        body: JSON.stringify({
          requests: batch.map((text) => ({
            model,
            content: { parts: [{ text }] },
            taskType: GeminiEmbeddingProvider.TASK[purpose],
            outputDimensionality: this.config.dimensions,
          })),
        }),
        signal: AbortSignal.timeout(
          this.config.timeoutMs ?? GeminiEmbeddingProvider.DEFAULT_TIMEOUT_MS,
        ),
      });
    } catch {
      this.fail(batch.length);
      throw new UnavailableError("gemini.embeddings");
    }
  }

  private fail(chunks: number): void {
    this.logger?.emit("embedding.request.failed", { model: this.config.model, chunks });
  }
}
