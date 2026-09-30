import { ForbiddenError, InternalError, type Placement, sql, UnitOfWork } from "../../import.js";
import type { DatabaseCluster, DrizzleClient } from "../primitive/index.js";
import type { ShardScope } from "./shard-scope.js";
import type { TransactionScope } from "./transaction-scope.js";

export interface PgUnitOfWorkConfig {
  // The ceiling for work inside `run`, when it differs from the role floor migration
  // `0022` sets. The worker's batch budget; absent in the web app, which wants the floor.
  readonly statementTimeoutMs?: number;
}

// Two instances, bound per slice at the DI root — decision D16. The port stays
// `run(work)`, so no use-case knows which one it was handed.
export class PgUnitOfWork extends UnitOfWork {
  public constructor(
    private readonly cluster: DatabaseCluster,
    private readonly scope: TransactionScope,
    private readonly shards: ShardScope,
    private readonly placement: Placement,
    private readonly config: PgUnitOfWorkConfig = {},
  ) {
    super();
  }

  // Inside an open transaction of the same placement this is a savepoint on the same
  // connection. Off the pool it is a second one, which cannot roll back with it.
  public override async run<T>(work: () => Promise<T>): Promise<T> {
    const open = this.scope.current();

    // **The write freeze.** Only `routed` and `local` rows are copied by a move, so a
    // catalog write cannot be lost by one and is never refused — decision `24.2`.
    if (this.placement !== "catalog" && this.shards.current()?.frozen === true) {
      throw new ForbiddenError("shard.move.inFlight");
    }

    // Only when opening one: a transaction already open is the quiesce's lock to wait for.
    if (!open) await this.recheck();

    // A catalog use-case calling a routed one inside its transaction is precisely the
    // coupling a physical split cannot honour, so it fails here on one node.
    if (open && open.placement !== this.placement) {
      throw new InternalError(
        new Error(`A ${this.placement} transaction inside a ${open.placement} one.`),
      );
    }

    return this.handle().transaction(async (tx) => {
      await this.applyStatementTimeout(tx);
      return this.scope.within(tx, this.placement, work);
    });
  }

  // A job placed before a freeze can outlive the settle, so it asks again per transaction:
  // one cached resolve. A node that changed means the move completed under it.
  private async recheck(): Promise<void> {
    const placed = this.shards.current();
    if (this.placement === "catalog" || !placed?.recheck || placed.key === null) return;

    const now = await this.cluster.placementOf(placed.key);
    if (now.frozen || now.node !== placed.node) throw new ForbiddenError("shard.move.inFlight");
  }

  // `SET LOCAL`, never `SET`: it dies with the transaction, so it survives a transaction
  // pooler handing this server connection to somebody else. See docs/reference/unit-of-work.md.
  private async applyStatementTimeout(tx: DrizzleClient): Promise<void> {
    const ms = this.config.statementTimeoutMs;
    if (ms === undefined) return;

    // Skipped when a transaction is already open, because this is a savepoint and the
    // outer `run` has set it — and `SET LOCAL` here would outlive the savepoint's rollback.
    if (this.scope.current()) return;

    // `sql.raw`, because Postgres accepts no bind parameter in a `SET` — the same trap
    // the partition DDL documents. Truncated to an integer, which is the whole grammar.
    await tx.execute(sql.raw(`set local statement_timeout = ${Math.trunc(ms)}`));
  }

  // The open handle when there is one, the placed pool otherwise — the same resolution
  // `BaseRepository` does, so a nested run sees what the repositories see.
  private handle(): DrizzleClient {
    const open = this.scope.current();
    if (open) return open.client;

    if (this.placement === "catalog") return this.cluster.catalog().client;

    const placed = this.shards.current();
    // `local` on the node a sweep placed itself on, node 0 outside one — the same
    // resolution `BaseRepository.pool` does, so a nested run sees what it sees.
    if (this.placement === "local") return this.cluster.at(placed?.node ?? 0).client;

    if (!placed) {
      throw new InternalError(new Error("A routed transaction with no shard in scope."));
    }

    return this.cluster.at(placed.node).client;
  }
}
