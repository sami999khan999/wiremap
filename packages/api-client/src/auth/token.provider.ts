// Where the token lives differs by host, and every such store is asynchronous — which
// is why `get()` returns a promise.
export abstract class TokenProvider {
  public abstract get(): Promise<string | null>;

  // `set(null)` is the clear path. Two methods cover storing, reading and signing
  // out — a third would be one more thing for an implementation to get wrong (30).
  public abstract set(token: string | null): Promise<void>;
}
