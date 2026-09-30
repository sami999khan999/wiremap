import { UnavailableError } from "@loadbearing/errors";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GeminiEmbeddingProvider } from "../../src/gemini/index.js";

interface Sent {
  readonly url: string;
  readonly headers: Record<string, string>;
  readonly body: {
    readonly requests: readonly {
      readonly model: string;
      readonly content: { readonly parts: readonly { readonly text: string }[] };
      readonly taskType: string;
      readonly outputDimensionality: number;
    }[];
  };
}

// A recorded exchange: every request is kept, and each answer is one vector per text,
// or `short` fewer, which is the misalignment the provider has to refuse.
const recording = (short = 0) => {
  const sent: Sent[] = [];
  vi.stubGlobal("fetch", (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as Sent["body"];
    sent.push({ url, headers: init.headers as Record<string, string>, body });
    const embeddings = body.requests.slice(short).map((_, index) => ({ values: [index, 0, 0] }));
    return Promise.resolve(new Response(JSON.stringify({ embeddings }), { status: 200 }));
  });
  return sent;
};

const provider = () =>
  new GeminiEmbeddingProvider({ apiKey: "key", model: "gemini-embedding-001", dimensions: 1536 });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("GeminiEmbeddingProvider", () => {
  it("sends one batch request with the task, the model and 1536 dimensions", async () => {
    const sent = recording();

    const vectors = await provider().embed(["a", "b"], "query");

    expect(vectors).toHaveLength(2);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.url).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:batchEmbedContents",
    );
    // The key in a header, never the query string, where an access log would keep it.
    expect(sent[0]?.headers["x-goog-api-key"]).toBe("key");
    expect(sent[0]?.url).not.toContain("key=");
    expect(sent[0]?.body.requests.map((request) => request.taskType)).toEqual([
      "RETRIEVAL_QUERY",
      "RETRIEVAL_QUERY",
    ]);
    expect(sent[0]?.body.requests[0]?.outputDimensionality).toBe(1536);
    expect(sent[0]?.body.requests[0]?.model).toBe("models/gemini-embedding-001");
    expect(sent[0]?.body.requests[1]?.content.parts[0]?.text).toBe("b");
  });

  it("embeds as a document when no purpose is given", async () => {
    const sent = recording();

    await provider().embed(["a"]);

    expect(sent[0]?.body.requests[0]?.taskType).toBe("RETRIEVAL_DOCUMENT");
  });

  it("splits more than a hundred texts into batches, in order", async () => {
    const sent = recording();

    const vectors = await provider().embed(Array.from({ length: 150 }, (_, i) => `t${i}`));

    expect(sent.map((request) => request.body.requests.length)).toEqual([100, 50]);
    expect(vectors).toHaveLength(150);
  });

  it("refuses an answer with fewer vectors than texts", async () => {
    recording(1);

    await expect(provider().embed(["a", "b"])).rejects.toBeInstanceOf(UnavailableError);
  });

  it("reports the model it embeds with, so chunks record it", () => {
    expect(provider().model).toBe("gemini-embedding-001");
    expect(provider().dimensions).toBe(1536);
  });
});
