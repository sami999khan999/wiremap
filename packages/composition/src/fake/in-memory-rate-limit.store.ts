import { RateLimitStore } from "../import.js";

// Counts per key and never expires: a spec that needs a window to end builds a new one.
export class InMemoryRateLimitStore extends RateLimitStore {
  private readonly counts = new Map<string, number>();

  public override hit(key: string): Promise<number> {
    const count = (this.counts.get(key) ?? 0) + 1;
    this.counts.set(key, count);
    return Promise.resolve(count);
  }
}
