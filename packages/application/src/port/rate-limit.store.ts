// A counter per key that forgets itself when its window ends. The transport counts calls
// here; what the limits are is its own policy, not the domain's.
export abstract class RateLimitStore {
  // Counts one call and returns the count inside the current window, this one included.
  // The window starts at the first call and is fixed from there.
  public abstract hit(key: string, windowSeconds: number): Promise<number>;
}
