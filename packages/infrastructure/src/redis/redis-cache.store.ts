import { CacheStore, type Logger, type Redis } from "../import.js";

export class RedisCacheStore extends CacheStore {
  public constructor(
    private readonly redis: Redis,
    private readonly logger?: Logger,
  ) {
    super();
  }

  public override async get<T>(key: string): Promise<T | null> {
    const raw = await this.redis.get(key);
    if (raw === null) return null;

    try {
      return JSON.parse(raw) as T;
    } catch {
      // A corrupt entry is a miss, never an error. Throwing turns a stale cache
      // after a DTO change into an outage; evicting turns it into a latency bump.
      this.logger?.emit("cache.entry.corrupt", { key });
      await this.redis.del(key);
      return null;
    }
  }

  public override async set<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
    await this.redis.set(key, JSON.stringify(value), "EX", ttlSeconds);
  }

  // One round trip, and the atomicity is Redis's: `NX` is evaluated on the server, so
  // two replicas racing the same key cannot both be told they wrote it.
  public override async setIfAbsent<T>(
    key: string,
    value: T,
    ttlSeconds: number,
  ): Promise<boolean> {
    const result = await this.redis.set(key, JSON.stringify(value), "EX", ttlSeconds, "NX");
    return result === "OK";
  }

  public override async delete(key: string): Promise<void> {
    await this.redis.del(key);
  }

  public override async deletePrefix(prefix: string): Promise<void> {
    // ioredis does not apply `keyPrefix` to SCAN in either direction, so handing its
    // results to `unlink` prefixes them twice and silently deletes nothing.
    const keyPrefix = this.redis.options.keyPrefix ?? "";
    const pattern = `${keyPrefix}${prefix}*`;
    let cursor = "0";

    // SCAN with UNLINK, never KEYS with DEL: KEYS is O(n) over the whole keyspace
    // and blocks the server, and UNLINK frees memory off the main thread.
    do {
      const [next, keys] = await this.redis.scan(cursor, "MATCH", pattern, "COUNT", 200);
      cursor = next;
      if (keys.length > 0) {
        await this.redis.unlink(...keys.map((key) => key.slice(keyPrefix.length)));
      }
    } while (cursor !== "0");
  }
}
