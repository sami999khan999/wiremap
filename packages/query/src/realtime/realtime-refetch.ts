import type { QueryClient, QueryKey } from "../import.js";

// A busy room sends frames faster than a page can be fetched. One refetch per key per
// second is as fresh as a person can read, and a burst costs two requests, not twenty.
const MIN_INTERVAL_MS = 1_000;

interface Pending {
  again: boolean;
}

// Single-flight per key with one trailing run: a frame that lands mid-fetch is answered by
// one more fetch after it, never by one each. One instance per stream, never shared.
export class RealtimeRefetch {
  private readonly running = new Map<string, Pending>();
  private disposed = false;

  public constructor(
    private readonly queryClient: QueryClient,
    private readonly minIntervalMs: number = MIN_INTERVAL_MS,
  ) {}

  public request(queryKey: QueryKey): void {
    if (this.disposed) return;

    const id = JSON.stringify(queryKey);
    const pending = this.running.get(id);
    if (pending) {
      pending.again = true;
      return;
    }

    const entry: Pending = { again: false };
    this.running.set(id, entry);
    void this.run(id, queryKey, entry);
  }

  public dispose(): void {
    this.disposed = true;
  }

  private async run(id: string, queryKey: QueryKey, entry: Pending): Promise<void> {
    try {
      do {
        entry.again = false;
        const startedAt = Date.now();
        // Active queries only, which is the default: a screen nobody is on refetches when
        // it is next opened, not on every frame for the life of the tab.
        await this.queryClient.invalidateQueries({ queryKey }).catch(() => undefined);

        const rest = this.minIntervalMs - (Date.now() - startedAt);
        if (rest > 0) await new Promise((resolve) => setTimeout(resolve, rest));
      } while (entry.again && !this.disposed);
    } finally {
      this.running.delete(id);
    }
  }
}
