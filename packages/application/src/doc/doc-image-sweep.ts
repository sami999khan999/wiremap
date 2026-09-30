import type { StorageGateway } from "../port/index.js";

// Empties one prefix of doc images. The prefix is the whole index: a space's images are
// under its own, a tenant's under its own, so there is no table to keep in step.
export class DocImageSweep {
  // One listing is at most a thousand keys; this bounds the walk if deletes stop landing.
  private static readonly MAX_PASSES = 1_000;

  public constructor(private readonly storage: StorageGateway) {}

  // Returns how many objects went. Sequential, because the caller is a delete path or a
  // job, and a thousand parallel deletes is a burst the bucket's rate limit would refuse.
  public async sweep(prefix: string): Promise<number> {
    let deleted = 0;
    for (let pass = 0; pass < DocImageSweep.MAX_PASSES; pass += 1) {
      const keys = await this.storage.list(prefix);
      if (keys.length === 0) break;
      for (const key of keys) await this.storage.delete(key);
      deleted += keys.length;
    }
    return deleted;
  }
}
