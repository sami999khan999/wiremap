import { Identifiers } from "@loadbearing/contracts";
import { CapabilitySet, type PermissionKey } from "@loadbearing/permissions";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ReembedChunksUseCase } from "../../src/ai/reembed-chunks.use-case.js";
import { SearchDocumentsUseCase } from "../../src/ai/search-documents.use-case.js";
import type {
  ActivityLogger,
  EmbeddingProvider,
  SearchHit,
  StaleChunk,
  UnitOfWork,
  VectorStore,
} from "../../src/port/index.js";
import { Authorizer } from "../../src/primitive/authorizer.js";
import { Principal } from "../../src/primitive/principal.js";

const ORG = Identifiers.organizationId.parse("018f8c00-0000-7000-8000-000000000010");
const ACTOR = Identifiers.userId.parse("018f8c00-0000-7000-8000-000000000011");

const actorHolding = (...grants: readonly PermissionKey[]) =>
  new Principal(
    ORG,
    ACTOR,
    CapabilitySet.from({ wildcard: false, org: { grants: [...grants], denies: [] }, goals: {} }),
  );

const HIT: SearchHit = { id: "c1", sourceId: "d1", content: "invoices", score: 0.5, metadata: {} };

// Records which search ran, and holds the stale chunks the re-embed pass drains.
class Vectors implements VectorStore {
  public readonly calls: string[] = [];
  public models: string[] = [];
  public saved: { id: string; model: string }[] = [];

  public constructor(private staleQueue: StaleChunk[] = []) {}

  public upsert(): Promise<void> {
    throw new Error("not under test");
  }

  public deleteBySource(): Promise<void> {
    throw new Error("not under test");
  }

  public sourceOf(): Promise<null> {
    return Promise.resolve(null);
  }

  public search(_org: unknown, _embedding: unknown, model: string): Promise<readonly SearchHit[]> {
    this.calls.push("search");
    this.models.push(model);
    return Promise.resolve([HIT]);
  }

  public searchText(): Promise<readonly SearchHit[]> {
    this.calls.push("searchText");
    return Promise.resolve([HIT]);
  }

  public stale(_org: unknown, _model: string, limit: number): Promise<readonly StaleChunk[]> {
    return Promise.resolve(this.staleQueue.slice(0, limit));
  }

  public saveEmbeddings(
    _org: unknown,
    embeddings: readonly { id: string }[],
    model: string,
  ): Promise<void> {
    const ids = new Set(embeddings.map((entry) => entry.id));
    this.staleQueue = this.staleQueue.filter((chunk) => !ids.has(chunk.id));
    this.saved.push(...embeddings.map((entry) => ({ id: entry.id, model })));
    return Promise.resolve();
  }
}

class Provider implements EmbeddingProvider {
  public readonly dimensions = 2;
  public readonly model = "active-model";
  public readonly purposes: (string | undefined)[] = [];

  public embed(texts: readonly string[], purpose?: string): Promise<readonly number[][]> {
    this.purposes.push(purpose);
    return Promise.resolve(texts.map(() => [1, 0]));
  }
}

const activity = { record: () => Promise.resolve() } as unknown as ActivityLogger;
const direct = { run: (work: () => Promise<unknown>) => work() } as unknown as UnitOfWork;

// Any outbound call fails the spec: `none` is the mode that must work with no network.
beforeEach(() => {
  vi.stubGlobal("fetch", () => Promise.reject(new Error("no network in lexical mode")));
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("SearchDocumentsUseCase — lexical", () => {
  it("searches the text, returns the same hit shape, and calls nobody", async () => {
    const vectors = new Vectors();
    const useCase = new SearchDocumentsUseCase(
      new Authorizer(),
      { kind: "lexical" },
      vectors,
      activity,
      direct,
    );

    const hits = await useCase.execute(actorHolding("ai.embedding.read"), {
      query: "invoices",
      limit: 5,
    });

    expect(hits).toEqual([HIT]);
    expect(vectors.calls).toEqual(["searchText"]);
  });
});

describe("SearchDocumentsUseCase — semantic", () => {
  // The query is embedded as a query, and only the active model's chunks are compared.
  it("embeds the query as a query and searches its own model's vectors", async () => {
    const vectors = new Vectors();
    const provider = new Provider();
    const useCase = new SearchDocumentsUseCase(
      new Authorizer(),
      { kind: "semantic", provider },
      vectors,
      activity,
      direct,
    );

    await useCase.execute(actorHolding("ai.embedding.read"), { query: "invoices", limit: 5 });

    expect(provider.purposes).toEqual(["query"]);
    expect(vectors.calls).toEqual(["search"]);
    expect(vectors.models).toEqual(["active-model"]);
  });
});

describe("ReembedChunksUseCase", () => {
  it("re-embeds every stale chunk under the active model, in batches", async () => {
    const stale = Array.from({ length: 150 }, (_, index) => ({ id: `c${index}`, content: "t" }));
    const vectors = new Vectors(stale);
    const provider = new Provider();
    const useCase = new ReembedChunksUseCase(
      new Authorizer(),
      { kind: "semantic", provider },
      vectors,
      direct,
    );

    const result = await useCase.execute(actorHolding("ai.embedding.write"));

    expect(result.chunks).toBe(150);
    expect(new Set(vectors.saved.map((entry) => entry.model))).toEqual(new Set(["active-model"]));
    expect(provider.purposes).toEqual(["document", "document"]);
  });

  it("does nothing with no provider", async () => {
    const vectors = new Vectors([{ id: "c1", content: "t" }]);
    const useCase = new ReembedChunksUseCase(
      new Authorizer(),
      { kind: "lexical" },
      vectors,
      direct,
    );

    expect(await useCase.execute(actorHolding("ai.embedding.write"))).toEqual({ chunks: 0 });
    expect(vectors.saved).toEqual([]);
  });
});
