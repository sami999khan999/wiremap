import { CacheStore } from "../import.js";

// A Map with TTLs that are recorded and never enforced. Tests that care about
// expiry drive the clock themselves; a fake that expired on wall time would be flaky.
export class InMemoryCacheStore extends CacheStore {
  private readonly entries = new Map<string, { value: unknown; ttlSeconds: number }>();

  public override get<T>(key: string): Promise<T | null> {
    const entry = this.entries.get(key);
    return Promise.resolve(entry ? (entry.value as T) : null);
  }

  public override set<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
    this.entries.set(key, { value, ttlSeconds });
    return Promise.resolve();
  }

  // Single-threaded, so the check and the write cannot interleave here the way `NX`
  // stops them interleaving on the server.
  public override setIfAbsent<T>(key: string, value: T, ttlSeconds: number): Promise<boolean> {
    if (this.entries.has(key)) return Promise.resolve(false);
    this.entries.set(key, { value, ttlSeconds });
    return Promise.resolve(true);
  }

  public override delete(key: string): Promise<void> {
    this.entries.delete(key);
    return Promise.resolve();
  }

  public override deletePrefix(prefix: string): Promise<void> {
    for (const key of this.entries.keys()) {
      if (key.startsWith(prefix)) this.entries.delete(key);
    }
    return Promise.resolve();
  }

  // What a test asserts against. The TTL is here because "cached for sixty seconds"
  // is a claim worth checking, and the real store cannot be asked.
  public ttlOf(key: string): number | null {
    return this.entries.get(key)?.ttlSeconds ?? null;
  }

  public size(): number {
    return this.entries.size;
  }
}
