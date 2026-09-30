import type { ShardKey } from "../../import.js";
import { AsyncLocalStorage } from "../../import.js";

// A key and the node it resolved to. **Both**, because the node is what a pool lookup
// needs and the key is what a log line and a nested resolve need.
export interface PlacedShard {
  // Resolved with the node, never per query. A move freezes writes to the tenant's own
  // rows; reads keep answering from `node`, which still holds them — decision `24.2`.
  readonly frozen?: boolean;
  // `null` in a cross-tenant sweep, which is placed on a node without being placed on
  // a tenant — the outbox drain and the partition runway are every tenant on that node.
  readonly key: ShardKey | null;
  readonly node: number;
  // A job's placement outlives the move's settle, so its every transaction re-reads
  // it; a request's does not, because the settle covers it — decision `24.2b`.
  readonly recheck?: boolean;
  // The operator's switch, `platform_policy.replica_reads_enabled`, as the job read it
  // when it started. Only `BaseRepository.reader` looks, and only outside a transaction.
  readonly replica?: boolean;
}

// Which shard the ambient work belongs to. Established once per request in the web
// middleware and once per job in a consumer — never per query.
export class ShardScope {
  private readonly storage = new AsyncLocalStorage<PlacedShard>();

  // Undefined outside any placed work, which is the honest answer for a catalog read
  // on the sign-in path: no key is known yet, and none is needed.
  public current(): PlacedShard | undefined {
    return this.storage.getStore();
  }

  // The node is resolved by the caller, before this runs. That is the whole reason
  // `BaseRepository.db` can stay synchronous: the one await happens once, out here.
  public async within<T>(placed: PlacedShard, work: () => Promise<T>): Promise<T> {
    return this.storage.run(placed, work);
  }

  // A node with no tenant: what a per-shard sweep runs inside. It places `local` work
  // and a routed read of *every* tenant on the node, which is what a sweep is.
  public async atNode<T>(node: number, work: () => Promise<T>): Promise<T> {
    return this.storage.run({ key: null, node }, work);
  }

  // For a caller that owns the rest of its context and has no callback to wrap — a
  // spec's hooks, and nothing in `src/`, where `within` is always the shape.
  public enter(placed: PlacedShard): void {
    this.storage.enterWith(placed);
  }
}
