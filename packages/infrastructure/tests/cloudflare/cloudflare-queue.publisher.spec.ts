import { CacheStore } from "@loadbearing/application";
import { describe, expect, it } from "vitest";
import {
  CloudflareQueuePublisher,
  type DispatchedMessage,
} from "../../src/cloudflare/cloudflare-queue.publisher.js";
import { JobSignatureHasher } from "../../src/cloudflare/job-signature.hasher.js";

const NOW = 1_800_000_000_000;

// TTLs are not modelled: each case runs inside one window.
class MapCacheStore extends CacheStore {
  public readonly entries = new Map<string, unknown>();
  public async get<T>(key: string): Promise<T | null> {
    return (this.entries.get(key) as T | undefined) ?? null;
  }
  public async set<T>(key: string, value: T): Promise<void> {
    this.entries.set(key, value);
  }
  public async setIfAbsent<T>(key: string, value: T): Promise<boolean> {
    if (this.entries.has(key)) return false;
    this.entries.set(key, value);
    return true;
  }
  public async delete(key: string): Promise<void> {
    this.entries.delete(key);
  }
  public async deletePrefix(prefix: string): Promise<void> {
    for (const key of [...this.entries.keys()])
      if (key.startsWith(prefix)) this.entries.delete(key);
  }
}

function harness(status = 200) {
  const requests: { url: string; body: string; headers: Record<string, string> }[] = [];
  const fetcher = (async (url: string, init: RequestInit) => {
    requests.push({
      url,
      body: String(init.body),
      headers: init.headers as Record<string, string>,
    });
    return new Response(null, { status });
  }) as unknown as typeof fetch;
  const cache = new MapCacheStore();
  const publisher = new CloudflareQueuePublisher(
    { url: "https://dispatch.example.test/", secret: "s" },
    cache,
    fetcher,
    () => NOW,
  );
  const sent = (): DispatchedMessage[] =>
    requests.flatMap(
      (request) => (JSON.parse(request.body) as { messages: DispatchedMessage[] }).messages,
    );
  return { publisher, requests, sent, cache };
}

describe("CloudflareQueuePublisher", () => {
  it("posts a signed batch to the dispatcher's enqueue path", async () => {
    const { publisher, requests } = harness();

    await publisher.publish("mail", { to: "a@example.test" }, { name: "send", jobId: "m1" });

    expect(requests).toHaveLength(1);
    const [request] = requests;
    expect(request?.url).toBe("https://dispatch.example.test/enqueue");
    expect(
      JobSignatureHasher.verify(
        "s",
        request?.headers[JobSignatureHasher.TIMESTAMP_HEADER] ?? null,
        request?.headers[JobSignatureHasher.SIGNATURE_HEADER] ?? null,
        request?.body ?? "",
        NOW,
      ),
    ).toBe(true);
  });

  it("carries the job name, id, attempts and delay", async () => {
    const { publisher, sent } = harness();

    await publisher.publish(
      "mail",
      { x: 1 },
      { name: "send", jobId: "m1", attempts: 3, delayMs: 1500 },
    );

    expect(sent()).toEqual([
      { queue: "mail", name: "send", id: "m1", data: { x: 1 }, maxAttempts: 3, delaySeconds: 2 },
    ]);
  });

  it("defaults the name to the queue and the attempts to eight", async () => {
    const { publisher, sent } = harness();

    await publisher.publish("embedding", { x: 1 });

    expect(sent()[0]).toMatchObject({ name: "embedding", maxAttempts: 8 });
  });

  it("drops a second job with the same id while the first is claimed", async () => {
    const { publisher, sent } = harness();

    await publisher.publish("mail", {}, { jobId: "same" });
    await publisher.publish("mail", {}, { jobId: "same" });
    await publisher.publish("mail", {}, { onceWithin: { id: "w", seconds: 60 } });
    await publisher.publish("mail", {}, { onceWithin: { id: "w", seconds: 60 } });

    expect(sent()).toHaveLength(2);
  });

  it("sends at most one hundred messages per request", async () => {
    const { publisher, requests } = harness();

    await publisher.publishMany(
      "event",
      Array.from({ length: 250 }, (_, index) => ({ payload: { index } })),
    );

    expect(requests.map((request) => JSON.parse(request.body).messages.length)).toEqual([
      100, 100, 50,
    ]);
  });

  // A claim kept for a message that never left would swallow the caller's retry.
  it("releases its claim when the dispatcher refuses", async () => {
    const { publisher, cache } = harness(503);

    await expect(publisher.publish("mail", {}, { jobId: "r1" })).rejects.toThrow("503");

    expect(await cache.get("queue:dedup:mail:r1")).toBeNull();
  });
});
