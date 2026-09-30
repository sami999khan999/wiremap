export abstract class CacheStore {
  public abstract get<T>(key: string): Promise<T | null>;
  public abstract set<T>(key: string, value: T, ttlSeconds: number): Promise<void>;

  // Writes only when the key is absent, and says which happened. `false` is how a caller
  // makes a non-transactional operation idempotent with no row to lock — see messaging.
  public abstract setIfAbsent<T>(key: string, value: T, ttlSeconds: number): Promise<boolean>;

  public abstract delete(key: string): Promise<void>;

  // Here rather than at the call site: enumerating keys by hand pushes Redis semantics
  // into the domain.
  public abstract deletePrefix(prefix: string): Promise<void>;
}
