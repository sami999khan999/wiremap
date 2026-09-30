import { RateLimitStore, type Redis } from "../import.js";

// A fixed window in the cache instance. Losing it resets every count, which is the right
// failure for a limit: nothing is lost that a person needed.
export class RedisRateLimitStore extends RateLimitStore {
  public constructor(private readonly redis: Redis) {
    super();
  }

  // `SET NX EX` then `INCR`, in one `MULTI`: the first call of a window starts it with its
  // expiry, and no call can land between the two. `EXPIRE … NX` would need Redis 7.
  public override async hit(key: string, windowSeconds: number): Promise<number> {
    const results = await this.redis
      .multi()
      .set(key, 0, "EX", windowSeconds, "NX")
      .incr(key)
      .exec();

    return Number(results?.[1]?.[1] ?? 0);
  }
}
