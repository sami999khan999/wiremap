import type { Placement } from "../../import.js";
import { AsyncLocalStorage } from "../../import.js";
import type { DrizzleClient } from "../primitive/index.js";

// The open transaction and **what it is a transaction on**. The placement is what
// makes a repository on the wrong side of the split fail here rather than at the split.
export interface OpenTransaction {
  readonly client: DrizzleClient;
  readonly placement: Placement;
}

// The seam BaseRepository reads. One instance, shared by the unit of work and
// every repository the container builds, so "am I in a transaction" has one answer.
export class TransactionScope {
  private readonly storage = new AsyncLocalStorage<OpenTransaction>();

  public current(): OpenTransaction | undefined {
    return this.storage.getStore();
  }

  public async within<T>(
    tx: DrizzleClient,
    placement: Placement,
    work: () => Promise<T>,
  ): Promise<T> {
    return this.storage.run({ client: tx, placement }, work);
  }
}
