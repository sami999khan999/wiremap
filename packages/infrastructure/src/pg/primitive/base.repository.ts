import {
  InternalError,
  type OrganizationId,
  type Placement,
  type Principal,
} from "../../import.js";
import type { ShardScope, TransactionScope } from "../transaction/index.js";
import type { Database, DrizzleClient } from "./database.js";
import type { DatabaseCluster } from "./database-cluster.js";

// `local` tables live on every node and are written in whichever transaction is open,
// so they are the one placement compatible with both of the others.
const compatible = (mine: Placement, open: Placement): boolean =>
  mine === open || mine === "local" || open === "local";

export abstract class BaseRepository {
  // Declared by every subclass, never inferred: a table's placement is decision D14's,
  // and a repository that guessed would guess wrong exactly once.
  protected abstract readonly placement: Placement;

  public constructor(
    protected readonly cluster: DatabaseCluster,
    protected readonly scope: TransactionScope,
    protected readonly shards: ShardScope,
  ) {}

  // The transaction handle when one is open, the right pool otherwise. **Synchronous**,
  // because the node was resolved once when the scope was entered — see shard-scope.ts.
  protected get db(): DrizzleClient {
    const open = this.scope.current();
    if (!open) return this.pool().client;

    // The tripwire. On one node this throws where a split would silently read the
    // wrong database, which is why it exists before the split rather than after.
    if (!compatible(this.placement, open.placement)) {
      throw new InternalError(
        new Error(`A ${this.placement} table inside a ${open.placement} transaction.`),
      );
    }

    return open.client;
  }

  // **The one sanctioned crossing**, and only from `local`: a sweep that detaches a
  // partition on a node and records what it did in a catalog index. See sharding.md.
  protected get catalogDb(): DrizzleClient {
    if (this.placement !== "local") {
      throw new InternalError(
        new Error(`A ${this.placement} repository reaching past its own placement.`),
      );
    }

    // Never the open transaction's client. That transaction is on whichever node the
    // sweep is walking, and the index row does not live there.
    return this.cluster.catalog().client;
  }

  // **For a read that may be served by a standby** — `24.3`. Inside a transaction it is
  // the transaction, because read-your-writes is what a transaction is for.
  // ──
  // Otherwise the replica when the placement allows it and the replica has caught up.
  protected async reader(): Promise<DrizzleClient> {
    if (this.scope.current() || this.shards.current()?.replica !== true) return this.db;
    return (await this.cluster.readerAt(this.nodeOfPool())).client;
  }

  // The direct pool, for the DDL a transaction pooler cannot carry. Never inside a
  // transaction, which is what makes it direct.
  protected get direct(): Database {
    if (this.placement === "catalog") return this.cluster.directCatalog();
    if (this.placement === "routed") return this.cluster.directAt(this.node());

    return this.cluster.directAt(this.shards.current()?.node ?? 0);
  }

  private pool(): Database {
    return this.cluster.at(this.nodeOfPool());
  }

  private nodeOfPool(): number {
    if (this.placement === "catalog") return 0;
    if (this.placement === "routed") return this.node();

    // `local` follows the node a sweep placed itself on, and falls back to the catalog
    // pool outside one — node 0 is the only node an unsharded deployment has.
    return this.shards.current()?.node ?? 0;
  }

  private node(): number {
    const placed = this.shards.current();
    if (!placed) {
      throw new InternalError(new Error("A routed query with no shard in scope."));
    }
    return placed.node;
  }

  // Every tenant-scoped query starts here. A method that cannot narrow by this is
  // a cross-tenant read waiting to happen.
  protected tenant(actor: Principal): OrganizationId {
    return actor.organizationId;
  }
}
