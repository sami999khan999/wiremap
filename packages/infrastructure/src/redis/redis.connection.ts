import { Redis, type RedisOptions } from "../import.js";

export interface RedisConfig {
  // Evicts under pressure. Everything on it rebuilds from Postgres.
  readonly cacheUrl: string;
  // Never evicts. A queued job is derived from nothing.
  readonly queueUrl: string;
  // Live frames. Absent, or equal to the cache's, and they ride the cache instance with no
  // extra socket; set apart, sessions and permissions stop sharing a CPU with fan-out.
  readonly realtimeUrl?: string;
  // Deliberately not the project name: a literal here survives a rename and comes back as
  // a cache that reads nothing, so the real value is a deployment decision.
  readonly keyPrefix?: string;
}

// Which instance a consumer is asking about. The health check takes it rather than
// exposing the clients, so `Container` never names `Redis` (17).
export type RedisRole = "cache" | "queue" | "subscriber" | "realtime";

// Two URLs, one class. Which connection a consumer gets is a property of what
// it is doing, not a wiring decision two same-typed arguments could get backwards.
export class RedisConnection {
  private readonly clients = new Map<RedisRole, Redis>();
  private closed = false;

  public constructor(private readonly config: RedisConfig) {}

  // Cache and session reads. Prefixed, and safe to share.
  public client(): Redis {
    return this.resolve("cache");
  }

  // `maxRetriesPerRequest: null` is not optional — BullMQ's blocking commands sit
  // open indefinitely and ioredis's default retry limit kills them silently.
  public queueClient(): Redis {
    return this.resolve("queue");
  }

  // Where live frames are published. The cache client itself unless a separate instance
  // is configured, so the default opens nothing new.
  public realtimeClient(): Redis {
    return this.separateRealtime() ? this.resolve("realtime") : this.client();
  }

  // A connection in subscriber mode can run nothing else, which is why this is a role
  // rather than a second use of `client()`. A process that never streams never opens it.
  public subscriberClient(): Redis {
    return this.resolve("subscriber");
  }

  // Whether a role has ever been resolved, without resolving it. Health reports `null`
  // for a connection this process never opened, and asking would be opening it.
  public opened(role: RedisRole): boolean {
    return this.clients.has(role);
  }

  // PING on the instance callers actually hold. Opening a second connection to answer
  // this would report on a socket nothing else uses — green while the cache is down.
  public async healthy(role: RedisRole): Promise<boolean> {
    try {
      const reply: unknown = await this.resolve(role).ping();
      // A connection in subscriber mode answers `["pong", ""]`, not the simple string —
      // and that connection is the one this check exists for.
      return Array.isArray(reply) ? reply[0] === "pong" : reply === "PONG";
    } catch {
      return false;
    }
  }

  // One client per role, memoised. `client()` called twice is two TCP connections
  // otherwise, and the second one is invisible until the pool count is the symptom.
  private resolve(role: RedisRole): Redis {
    const existing = this.clients.get(role);
    if (existing) return existing;
    // After `close()`, a late caller — a stream's `finally` detaching — would otherwise
    // open a fresh socket that holds a stopping process open.
    if (this.closed) throw new Error(`Redis is closed; refusing to open the ${role} connection`);

    const created = this.build(role);

    this.clients.set(role, created);
    return created;
  }

  // The subscriber dials the realtime instance, which is the cache's unless one is set.
  // Neither `PUBLISH` nor `SUBSCRIBE` declares a key; `SPUBLISH` does — see realtime.md.
  private build(role: RedisRole): Redis {
    const prefix = this.config.keyPrefix ?? "app:";

    if (role === "queue") {
      return this.create(this.config.queueUrl, {
        maxRetriesPerRequest: null,
        enableReadyCheck: false,
      });
    }

    const realtimeUrl = this.config.realtimeUrl ?? this.config.cacheUrl;

    if (role === "subscriber") {
      // Auto-pipelining batches commands issued in one tick, and a subscriber issues
      // almost none: the traffic it carries is pushed, not requested.
      return this.create(realtimeUrl, { keyPrefix: prefix, enableAutoPipelining: false });
    }

    if (role === "realtime") return this.create(realtimeUrl, { keyPrefix: prefix });

    return this.create(this.config.cacheUrl, { keyPrefix: prefix });
  }

  private create(url: string, options: RedisOptions): Redis {
    return new Redis(url, {
      lazyConnect: false,
      // Batches commands issued in the same tick into one round trip.
      enableAutoPipelining: true,
      retryStrategy: (attempt) => Math.min(attempt * 200, 5_000),
      ...options,
    });
  }

  private separateRealtime(): boolean {
    const { realtimeUrl, cacheUrl } = this.config;
    return realtimeUrl !== undefined && realtimeUrl !== cacheUrl;
  }

  public async close(): Promise<void> {
    this.closed = true;
    await Promise.all([...this.clients.values()].map((client) => client.quit()));
    this.clients.clear();
  }
}
