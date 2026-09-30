import { describe, expect, it } from "vitest";
import type { Redis } from "../../src/import.js";
import { RedisCacheStore } from "../../src/redis/redis-cache.store.js";
import { RecordingLogger } from "../support/recording.logger.js";

// Only the three commands `get` reaches. A real client would make this a live-Redis
// spec, and what is being pinned here is a branch, not a round trip.
class FakeRedis {
  public readonly deleted: string[] = [];
  public readonly options = { keyPrefix: "" };

  public constructor(private readonly stored: string | null) {}

  public get(_key: string): Promise<string | null> {
    return Promise.resolve(this.stored);
  }

  public del(key: string): Promise<number> {
    this.deleted.push(key);
    return Promise.resolve(1);
  }
}

const store = (raw: string | null, logger?: RecordingLogger) => {
  const redis = new FakeRedis(raw);
  return { redis, cache: new RedisCacheStore(redis as unknown as Redis, logger) };
};

describe("RedisCacheStore", () => {
  it("returns the parsed entry", async () => {
    const { cache } = store('{"id":"a"}');

    await expect(cache.get<{ id: string }>("capability:a")).resolves.toEqual({ id: "a" });
  });

  it("treats a corrupt entry as a miss and evicts it", async () => {
    const { redis, cache } = store("{not json");

    await expect(cache.get("capability:a")).resolves.toBeNull();
    expect(redis.deleted).toEqual(["capability:a"]);
  });

  // The regression guard: `cache.entry.corrupt` was in the catalog and emitted by
  // nothing, so a DTO change silently halved the hit rate.
  it("emits cache.entry.corrupt with the key", async () => {
    const logger = new RecordingLogger();
    const { cache } = store("{not json", logger);

    await cache.get("capability:a");

    expect(logger.entries).toEqual([
      expect.objectContaining({
        level: "warn",
        event: "cache.entry.corrupt",
        fields: { key: "capability:a" },
      }),
    ]);
  });

  it("evicts without a logger", async () => {
    const { redis, cache } = store("{not json");

    await expect(cache.get("capability:a")).resolves.toBeNull();
    expect(redis.deleted).toHaveLength(1);
  });

  it("returns null on a miss without touching the key", async () => {
    const { redis, cache } = store(null);

    await expect(cache.get("capability:a")).resolves.toBeNull();
    expect(redis.deleted).toEqual([]);
  });
});
