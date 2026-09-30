import { Identifiers } from "@loadbearing/contracts";
import { ForbiddenError, UnavailableError, ValidationError } from "@loadbearing/errors";
import { CapabilitySet, type PermissionKey } from "@loadbearing/permissions";
import { describe, expect, it } from "vitest";
import { IndexDocumentUseCase } from "../../src/ai/index-document.use-case.js";
import type {
  ActivityLogger,
  EmbeddingProvider,
  UnitOfWork,
  VectorStore,
} from "../../src/port/index.js";
import { Authorizer } from "../../src/primitive/authorizer.js";
import { Principal } from "../../src/primitive/principal.js";

const ORG = Identifiers.organizationId.parse("018f8c00-0000-7000-8000-000000000010");
const USER = Identifiers.userId.parse("018f8c00-0000-7000-8000-000000000011");
const DOCUMENT = "018f8c00-0000-7000-8000-0000000000d1";

const actorHolding = (...grants: readonly PermissionKey[]) =>
  new Principal(
    ORG,
    USER,
    CapabilitySet.from({ wildcard: false, org: { grants, denies: [] }, goals: {} }),
  );

// Records what reached the store, and in which order — the ordering is the property
// worth pinning, because `deleteBySource` runs before `upsert`.
class RecordingVectorStore implements VectorStore {
  public readonly calls: string[] = [];
  public upserted: readonly {
    readonly content: string;
    readonly embedding: readonly number[] | null;
    readonly embeddingModel: string | null;
  }[] = [];

  public upsert(_organizationId: typeof ORG, chunks: readonly never[]): Promise<void> {
    this.calls.push("upsert");
    this.upserted = chunks;
    return Promise.resolve();
  }

  public deleteBySource(): Promise<void> {
    this.calls.push("delete");
    return Promise.resolve();
  }

  public search(): Promise<readonly never[]> {
    return Promise.resolve([]);
  }

  public searchText(): Promise<readonly never[]> {
    return Promise.resolve([]);
  }

  public stale(): Promise<readonly never[]> {
    return Promise.resolve([]);
  }

  public saveEmbeddings(): Promise<void> {
    return Promise.resolve();
  }

  // What is "already indexed" for the version tests; nothing, unless a test says so.
  public indexed: { goalId: string | null; version: number | null } | null = null;

  public sourceOf(): Promise<{ goalId: string | null; version: number | null } | null> {
    return Promise.resolve(this.indexed);
  }
}

class StubEmbeddingProvider implements EmbeddingProvider {
  public readonly dimensions = 4;
  public readonly model = "stub-model";

  public constructor(private readonly howMany: (texts: readonly string[]) => number) {}

  public embed(texts: readonly string[]): Promise<readonly (readonly number[])[]> {
    return Promise.resolve(
      Array.from({ length: this.howMany(texts) }, (_, i) => [i, 0, 0, 0] as readonly number[]),
    );
  }
}

const recordingActivity = () => {
  const actions: string[] = [];
  return {
    actions,
    logger: {
      record: (_actor: unknown, action: string) => {
        actions.push(action);
        return Promise.resolve();
      },
    },
  };
};

// Runs the work and opens nothing. Atomicity is asserted against Postgres.
const directUnitOfWork: UnitOfWork = { run: (work) => work() } as UnitOfWork;

const build = (embeddings: EmbeddingProvider | null, vectors = new RecordingVectorStore()) => {
  const activity = recordingActivity();
  const useCase = new IndexDocumentUseCase(
    new Authorizer(),
    embeddings === null ? { kind: "lexical" } : { kind: "semantic", provider: embeddings },
    vectors as unknown as VectorStore,
    activity.logger as unknown as ActivityLogger,
    directUnitOfWork,
  );
  return { useCase, vectors, activity };
};

// `core.activity.write` is not here: every resolved principal holds it, and the use-case
// asserting it made the audit port's own permission a feature permission.
const grants: readonly PermissionKey[] = ["ai.embedding.write"];

// Distinct characters rather than one repeated, so a slice says where it came from and
// an off-by-one in the stride is visible instead of self-consistent.
const letters = (length: number) =>
  Array.from({ length }, (_, index) => String.fromCharCode(97 + (index % 26))).join("");

const chunkCount = async (
  useCase: {
    execute: (
      actor: Principal,
      input: { documentId: typeof DOCUMENT; text: string },
    ) => Promise<{ chunks: number }>;
  },
  text: string,
) => (await useCase.execute(actorHolding(...grants), { documentId: DOCUMENT, text })).chunks;

describe("IndexDocumentUseCase", () => {
  it("chunks the text and writes one embedding per chunk", async () => {
    const { useCase, vectors, activity } = build(new StubEmbeddingProvider((t) => t.length));

    const result = await useCase.execute(actorHolding(...grants), {
      documentId: DOCUMENT,
      text: "a".repeat(2_400),
    });

    expect(result.chunks).toBeGreaterThan(1);
    expect(vectors.upserted).toHaveLength(result.chunks);
    expect(vectors.calls).toEqual(["delete", "upsert"]);
    expect(activity.actions).toEqual(["ai.document.indexed"]);
  });

  // `LT4.4`: with no provider the text is still written, so lexical search finds it.
  it("writes every chunk with no vector and no model when there is no provider", async () => {
    const { useCase, vectors } = build(null);

    const result = await useCase.execute(actorHolding(...grants), {
      documentId: DOCUMENT,
      text: "a".repeat(2_400),
    });

    expect(result.chunks).toBeGreaterThan(1);
    expect(vectors.upserted.every((chunk) => chunk.embedding === null)).toBe(true);
    expect(vectors.upserted.every((chunk) => chunk.embeddingModel === null)).toBe(true);
  });

  it("records the model on every chunk it embeds", async () => {
    const { useCase, vectors } = build(new StubEmbeddingProvider((t) => t.length));

    await useCase.execute(actorHolding(...grants), { documentId: DOCUMENT, text: "some text" });

    expect(vectors.upserted.map((chunk) => chunk.embeddingModel)).toEqual(["stub-model"]);
  });

  // 1,500-character windows on a 1,300 stride, so consecutive chunks share 200
  // characters and a sentence on a boundary is retrievable from either side.
  it("overlaps consecutive chunks by exactly the overlap width", async () => {
    const { useCase, vectors } = build(new StubEmbeddingProvider((t) => t.length));
    const text = letters(3_000);

    await useCase.execute(actorHolding(...grants), { documentId: DOCUMENT, text });

    const contents = vectors.upserted.map((chunk) => chunk.content);
    expect(contents[0]).toBe(text.slice(0, 1_500));
    expect(contents[1]).toBe(text.slice(1_300, 2_800));
    // The shared window, asserted from both sides rather than by arithmetic on one.
    expect(contents[0]?.slice(-200)).toBe(contents[1]?.slice(0, 200));
  });

  // The `break` is what stops a stride shorter than the window from emitting a tail
  // chunk that is entirely overlap — a duplicate embedding, and a duplicate hit.
  it("stops when the window reaches the end rather than one stride past it", async () => {
    const { useCase } = build(new StubEmbeddingProvider((t) => t.length));

    // Exactly one window: the first slice already covers the text.
    expect(await chunkCount(useCase, letters(1_500))).toBe(1);
    // One character more, and the second window is the 201 characters from 1,300 on.
    expect(await chunkCount(useCase, letters(1_501))).toBe(2);
    // Two strides plus a remainder, not three windows.
    expect(await chunkCount(useCase, letters(2_900))).toBe(3);
  });

  it("refuses text that is only whitespace, before reaching the provider", async () => {
    let embedded = false;
    const { useCase, vectors } = build(
      new StubEmbeddingProvider((t) => {
        embedded = true;
        return t.length;
      }),
    );

    await expect(
      useCase.execute(actorHolding(...grants), { documentId: DOCUMENT, text: "   \n\t  " }),
    ).rejects.toThrow(ValidationError);

    expect(embedded).toBe(false);
    expect(vectors.calls).toEqual([]);
  });

  // The regression guard: `vectors[index] ?? []` padded a short response with empties
  // that `vector(1536)` rejects — *after* `deleteBySource` had run.
  it("refuses a response with fewer vectors than texts, before deleting anything", async () => {
    const { useCase, vectors } = build(new StubEmbeddingProvider((t) => t.length - 1));

    await expect(
      useCase.execute(actorHolding(...grants), { documentId: DOCUMENT, text: "a".repeat(2_400) }),
    ).rejects.toThrow(UnavailableError);

    expect(vectors.calls).toEqual([]);
  });

  it("refuses a longer response too", async () => {
    const { useCase, vectors } = build(new StubEmbeddingProvider((t) => t.length + 1));

    await expect(
      useCase.execute(actorHolding(...grants), { documentId: DOCUMENT, text: "a".repeat(2_400) }),
    ).rejects.toThrow(UnavailableError);

    expect(vectors.calls).toEqual([]);
  });

  it("denies before reading, and before embedding", async () => {
    let embedded = false;
    const provider = new StubEmbeddingProvider((t) => {
      embedded = true;
      return t.length;
    });
    const { useCase, vectors } = build(provider);

    await expect(
      useCase.execute(actorHolding(), { documentId: DOCUMENT, text: "hello" }),
    ).rejects.toThrow(ForbiddenError);

    expect(embedded).toBe(false);
    expect(vectors.calls).toEqual([]);
  });
});

// `CR.33`. Two edits are two jobs; a retried older one landing after the newer one
// replaced its chunks with the stale text, and nothing said so.
describe("IndexDocumentUseCase — versions", () => {
  const actor = actorHolding(...grants);
  const one = new StubEmbeddingProvider((texts) => texts.length);

  it("skips a job older than what is indexed, before the provider is called", async () => {
    const vectors = new RecordingVectorStore();
    vectors.indexed = { goalId: null, version: 200 };
    let called = false;
    const { useCase } = build(
      new StubEmbeddingProvider((texts) => {
        called = true;
        return texts.length;
      }),
      vectors,
    );

    const result = await useCase.execute(actor, {
      documentId: DOCUMENT,
      text: "old",
      version: 100,
    });

    expect(result.chunks).toBe(0);
    expect(called).toBe(false);
    expect(vectors.calls).toEqual([]);
  });

  it("indexes its own retry, and anything newer, and stamps the version", async () => {
    const vectors = new RecordingVectorStore();
    vectors.indexed = { goalId: null, version: 100 };
    const { useCase } = build(one, vectors);

    const result = await useCase.execute(actor, {
      documentId: DOCUMENT,
      text: "new",
      version: 100,
    });

    expect(result.chunks).toBe(1);
    expect(vectors.calls).toEqual(["delete", "upsert"]);
    expect((vectors.upserted[0] as unknown as { metadata: unknown }).metadata).toMatchObject({
      version: 100,
    });
  });
});
