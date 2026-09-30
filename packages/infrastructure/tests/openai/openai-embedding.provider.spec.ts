import { UnavailableError } from "@loadbearing/errors";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OpenAiEmbeddingProvider } from "../../src/openai/openai-embedding.provider.js";

// The provider is driven entirely by `fetch`, so a stub of it is the whole double and
// these assertions stay true across a change of endpoint.
const respond = (body: unknown, ok = true) =>
  vi.fn().mockResolvedValue({ ok, status: ok ? 200 : 503, json: () => Promise.resolve(body) });

const provider = () =>
  new OpenAiEmbeddingProvider({ apiKey: "k", model: "m", dimensions: 4, endpoint: "http://stub" });

const vectorsFor = (count: number) =>
  Array.from({ length: count }, (_, index) => ({ index, embedding: [index, 0, 0, 0] }));

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("OpenAiEmbeddingProvider", () => {
  it("returns one vector per text, in the order the texts were given", async () => {
    // Deliberately shuffled: a batch endpoint does not guarantee response order.
    vi.stubGlobal("fetch", respond({ data: [...vectorsFor(3)].reverse() }));

    const embeddings = await provider().embed(["a", "b", "c"]);

    expect(embeddings.map((vector) => vector[0])).toEqual([0, 1, 2]);
  });

  // The regression guard: a short response was accepted, and the caller padded the gap
  // with empty vectors that `vector(1536)` rejects — after the delete had run.
  it("refuses a response with fewer vectors than texts", async () => {
    vi.stubGlobal("fetch", respond({ data: vectorsFor(2) }));

    await expect(provider().embed(["a", "b", "c"])).rejects.toThrow(UnavailableError);
  });

  it("refuses a response with more vectors than texts", async () => {
    vi.stubGlobal("fetch", respond({ data: vectorsFor(4) }));

    await expect(provider().embed(["a", "b", "c"])).rejects.toThrow(UnavailableError);
  });

  // `CR.12`. A reset or a DNS failure was a raw `TypeError`, which became INTERNAL and was
  // never retried; and with no signal a slow provider held a search for five minutes.
  it("turns a network failure into a retryable error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));

    await expect(provider().embed(["a"])).rejects.toThrow(UnavailableError);
  });

  it("gives every request a timeout", async () => {
    const fetch = respond({ data: vectorsFor(1) });
    vi.stubGlobal("fetch", fetch);

    await provider().embed(["a"]);

    expect(fetch.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
  });

  // UNAVAILABLE, not INTERNAL: the catalog marks it retryable, which is what lets a
  // queued job try again rather than dead-lettering on a blip.
  it("throws a retryable error on a failed request", async () => {
    vi.stubGlobal("fetch", respond({}, false));

    await expect(provider().embed(["a"])).rejects.toThrow(UnavailableError);
  });
});
