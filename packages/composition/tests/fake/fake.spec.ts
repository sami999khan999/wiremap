import { NotFoundError } from "@loadbearing/errors";
import { describe, expect, it } from "vitest";
import { TestContainer } from "../../src/container/test-container.js";
import {
  DirectUnitOfWork,
  InMemoryCacheStore,
  InMemoryOutboxGateway,
  InMemoryStorageGateway,
  InMemoryVectorStore,
  RecordingMailPublisher,
  RecordingQueuePublisher,
  StubEmbeddingProvider,
  StubMailRenderer,
} from "../../src/fake/index.js";
import type { DocumentChunk, OrganizationId } from "../../src/import.js";

const ORG = "00000000-0000-7000-8000-000000000001" as OrganizationId;

const chunk = (id: string, embedding: readonly number[], goalId: string | null): DocumentChunk => ({
  id,
  sourceId: `source-${id}`,
  goalId,
  content: `content ${id}`,
  embedding,
  embeddingModel: "stub-embedding",
  metadata: {},
});

describe("InMemoryCacheStore", () => {
  it("round-trips a value and records its ttl", async () => {
    const cache = new InMemoryCacheStore();
    await cache.set("capability:user:a", { wildcard: false }, 60);

    expect(await cache.get("capability:user:a")).toEqual({ wildcard: false });
    expect(cache.ttlOf("capability:user:a")).toBe(60);
  });

  it("deletes by prefix and leaves the rest", async () => {
    const cache = new InMemoryCacheStore();
    await cache.set("capability:user:a", 1, 60);
    await cache.set("capability:user:b", 2, 60);
    await cache.set("session:c", 3, 60);

    await cache.deletePrefix("capability:user:");

    expect(cache.size()).toBe(1);
    expect(await cache.get("session:c")).toBe(3);
  });
});

describe("RecordingQueuePublisher", () => {
  it("records what was published, per queue", async () => {
    const queue = new RecordingQueuePublisher();
    await queue.publish("embedding", { documentId: "d1" });
    await queue.publish("maintenance", { sweep: true });

    expect(queue.published()).toHaveLength(2);
    expect(queue.publishedTo("embedding")).toHaveLength(1);
  });

  it("treats a repeated jobId as a no-op, the way BullMQ does", async () => {
    const queue = new RecordingQueuePublisher();
    await queue.publish("embedding", { documentId: "d1" }, { jobId: "d1" });
    await queue.publish("embedding", { documentId: "d1" }, { jobId: "d1" });

    expect(queue.published()).toHaveLength(1);
  });

  it("treats a repeated onceWithin id as a no-op, the way BullMQ does", async () => {
    const queue = new RecordingQueuePublisher();
    const once = { onceWithin: { id: "m1", seconds: 60 } };
    await queue.publish("mail", { n: 1 }, once);
    await queue.publish("mail", { n: 2 }, once);

    expect(queue.published()).toHaveLength(1);
  });
});

describe("RecordingMailPublisher", () => {
  it("records what was published, per recipient", async () => {
    const mail = new RecordingMailPublisher();
    await mail.publish({
      template: "auth.verify",
      to: "a@example.test",
      locale: "en",
      params: { url: "https://example.test/v" },
      organizationId: null,
      userId: null,
    });

    expect(mail.publishedTo("a@example.test")).toHaveLength(1);
    expect(mail.published()[0]?.locale).toBe("en");
  });

  // The same contract `RecordingQueuePublisher` keeps, because `dedupeKey` becomes a
  // `onceWithin` id: a fake that ignored it would let "invite once" pass while it sent twice.
  it("treats a repeated dedupeKey as a no-op, the way BullMQ does", async () => {
    const mail = new RecordingMailPublisher();
    const request = {
      template: "member.invitation",
      to: "a@example.test",
      locale: "en",
      params: { url: "https://example.test/i", inviter: "A", organization: "O" },
      organizationId: null,
      userId: null,
      dedupeKey: "invite-1",
    } as const;

    await mail.publish(request);
    await mail.publish(request);

    expect(mail.published()).toHaveLength(1);
  });
});

describe("InMemoryOutboxGateway", () => {
  const event = (name: string) => ({
    organizationId: "018f8c00-0000-7000-8000-000000000010",
    name,
    actorId: "018f8c00-0000-7000-8000-000000000011",
    occurredAt: new Date("2026-01-01T00:00:00Z"),
    payload: {},
  });

  it("hands the relay a batch and removes it only once the relay resolves", async () => {
    const outbox = new InMemoryOutboxGateway();
    outbox.enqueue(event("member.joined") as never);

    const seen: string[] = [];
    expect(
      await outbox.drain(10, async (events) => {
        seen.push(...events.map((e) => e.name));
        return Promise.resolve();
      }),
    ).toBe(1);

    expect(seen).toEqual(["member.joined"]);
    expect(outbox.remaining()).toEqual([]);
  });

  // The transactional adapter rolls back on a failing relay, so the fake has to leave the
  // rows behind too — otherwise a spec proves an ordering the real one does not have.
  it("leaves the batch pending when the relay throws", async () => {
    const outbox = new InMemoryOutboxGateway();
    outbox.enqueue(event("member.joined") as never);

    await expect(outbox.drain(10, () => Promise.reject(new Error("down")))).rejects.toThrow();

    expect(outbox.remaining()).toHaveLength(1);
  });

  it("reports no lag when nothing is pending, which is not the same as unknown", async () => {
    expect(await new InMemoryOutboxGateway().oldestPendingAt()).toBeNull();
  });
});

describe("StubMailRenderer", () => {
  it("returns both parts, so a caller cannot pass by rendering text alone", async () => {
    const rendered = await new StubMailRenderer().render("auth.otp", "bn");

    expect(rendered.text).not.toBe("");
    expect(rendered.html).not.toBe("");
  });
});

describe("InMemoryStorageGateway", () => {
  it("round-trips bytes and reports absence after a delete", async () => {
    const storage = new InMemoryStorageGateway();
    const key = "receipt/2026/01/abc.txt";
    const stored = await storage.put(key, new TextEncoder().encode("hello"), "text/plain");

    expect(stored.size).toBe(5);
    expect(new TextDecoder().decode(await storage.get(key))).toBe("hello");

    await storage.delete(key);
    expect(await storage.exists(key)).toBe(false);
  });
});

describe("StubEmbeddingProvider", () => {
  it("is deterministic, which is what makes a ranking assertion possible", async () => {
    const embeddings = new StubEmbeddingProvider();
    const [first] = await embeddings.embed(["quarterly report"]);
    const [again] = await embeddings.embed(["quarterly report"]);

    expect(first).toEqual(again);
    expect(first).toHaveLength(embeddings.dimensions);
  });
});

describe("InMemoryVectorStore", () => {
  it("ranks by cosine, so the nearest chunk comes back first", async () => {
    const vectors = new InMemoryVectorStore();
    await vectors.upsert(ORG, [chunk("far", [0, 1], null), chunk("near", [1, 0], null)]);

    const [top] = await vectors.search(ORG, [1, 0], "stub-embedding", [], 10);

    expect(top?.id).toBe("near");
  });

  it("filters the input set by goal before scoring", async () => {
    const vectors = new InMemoryVectorStore();
    await vectors.upsert(ORG, [
      chunk("permitted", [1, 0], "goal-a"),
      chunk("hidden", [1, 0], "goal-b"),
    ]);

    const hits = await vectors.search(ORG, [1, 0], "stub-embedding", ["goal-a"], 10);

    expect(hits.map((hit) => hit.id)).toEqual(["permitted"]);
  });

  it("replaces a chunk on re-upsert rather than duplicating it", async () => {
    const vectors = new InMemoryVectorStore();
    await vectors.upsert(ORG, [chunk("a", [1, 0], null)]);
    await vectors.upsert(ORG, [chunk("a", [0, 1], null)]);

    expect(vectors.countFor(ORG)).toBe(1);
  });

  it("scopes by tenant", async () => {
    const other = "00000000-0000-7000-8000-000000000002" as OrganizationId;
    const vectors = new InMemoryVectorStore();
    await vectors.upsert(ORG, [chunk("a", [1, 0], null)]);

    expect(vectors.countFor(other)).toBe(0);
    expect(await vectors.search(other, [1, 0], "stub-embedding", [], 10)).toEqual([]);
  });

  it("drops every chunk from one source", async () => {
    const vectors = new InMemoryVectorStore();
    await vectors.upsert(ORG, [chunk("a", [1, 0], null), chunk("b", [0, 1], null)]);

    await vectors.deleteBySource(ORG, "source-a");

    expect(vectors.countFor(ORG)).toBe(1);
  });
});

// Each of these pins a place a fake once answered differently from the adapter it stands
// in for. A divergence here is a green suite over a broken deployment.
describe("the fakes agree with their adapters", () => {
  // `PgVectorStore` refuses anything under 0.3. Without the same floor a fake hands back
  // the least-unrelated chunk in the corpus and the caller's empty branch never runs.
  it("applies the same score floor the pg store applies", async () => {
    const vectors = new InMemoryVectorStore();
    await vectors.upsert(ORG, [chunk("a", [1, 0], null), chunk("b", [0, 1], null)]);

    const hits = await vectors.search(ORG, [1, 0], "stub-embedding", [], 10);

    expect(hits.map((hit) => hit.id)).toEqual(["a"]);
  });

  // `S3StorageGateway.get` throws `NotFoundError`. A bare `Error` lets a catch-by-code
  // branch pass against the fake and fail against S3.
  it("throws NotFoundError for an object that is not there", async () => {
    const storage = new InMemoryStorageGateway();

    await expect(storage.get("missing/key")).rejects.toBeInstanceOf(NotFoundError);
  });

  // `Container` wires `SERVER_CATALOG`; the default is the client one, which carries no
  // `email` namespace — so a spec touching either mailer resolved nothing.
  it("wires the catalog the container wires", async () => {
    const translator = await TestContainer.build().content.translator("en", ["email"]);

    expect(translator.t("email.invitation.subject", { organization: "Acme" })).not.toContain(
      "email.invitation.subject",
    );
  });
});

describe("DirectUnitOfWork", () => {
  it("runs the work and counts the call", async () => {
    const unitOfWork = new DirectUnitOfWork();
    const result = await unitOfWork.run(() => Promise.resolve("done"));

    expect(result).toBe("done");
    expect(unitOfWork.runCount()).toBe(1);
  });
});
