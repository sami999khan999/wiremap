import { afterAll, describe, expect, it } from "vitest";
import { type Placement, sql } from "../../src/import.js";
import { BaseRepository, Database, DatabaseCluster } from "../../src/pg/primitive/index.js";
import { ShardScope, TransactionScope } from "../../src/pg/transaction/index.js";
import { openDatabase } from "../support/database.js";

// `24.3`'s two fallbacks, which need no standby to prove: no replica configured, and one
// that cannot be reached. Both are a read on the primary, never a failed read.

const primary = openDatabase();
// Port 1: refused at once, so the fallback is measured rather than waited for.
const unreachable = new Database({
  url: "postgres://ratchet:ratchet@localhost:1/ratchet",
  connectionTimeoutMs: 500,
});

afterAll(async () => {
  await Promise.all([primary.close(), unreachable.close()]);
});

const resolver = {
  resolve: () => Promise.resolve(0),
  placementOf: () => Promise.resolve({ node: 0, frozen: false }),
  invalidate: () => Promise.resolve(),
};

describe("DatabaseCluster.readerAt", () => {
  it("is the primary when the node has no replica", async () => {
    const cluster = DatabaseCluster.of([{ pooled: primary, direct: primary }], resolver);

    expect((await cluster.readerAt(0)) === primary).toBe(true);
    expect(cluster.hasReplicas).toBe(false);
    expect(await cluster.replicaHealth()).toEqual([]);
  });

  it("falls back to the primary when the replica cannot be reached", async () => {
    const cluster = DatabaseCluster.of(
      [{ pooled: primary, direct: primary, replica: unreachable }],
      resolver,
    );

    expect((await cluster.readerAt(0)) === primary).toBe(true);
    expect(await cluster.replicaHealth()).toEqual([{ node: 0, healthy: false, lagSeconds: null }]);
  });

  // A primary answers `pg_last_wal_replay_lsn()` with null. Configured by mistake as its
  // own replica, it must never be taken for one that has caught up.
  it("never takes a server that is not in recovery for a caught-up replica", async () => {
    const other = openDatabase();
    try {
      const cluster = DatabaseCluster.of(
        [{ pooled: primary, direct: primary, replica: other }],
        resolver,
      );
      expect((await cluster.readerAt(0)) === primary).toBe(true);
    } finally {
      await other.close();
    }
  });
});

// What a repository sees: the primary unless its placement carries the switch.
class RecoveryProbe extends BaseRepository {
  protected override readonly placement: Placement = "local";

  public async inRecovery(): Promise<boolean> {
    const reader = await this.reader();
    const found = await reader.execute<{ standby: boolean }>(
      sql`select pg_is_in_recovery() as standby`,
    );
    return found.rows[0]?.standby === true;
  }
}

describe("BaseRepository.reader", () => {
  it("reads the primary when the placement does not allow a replica", async () => {
    const cluster = DatabaseCluster.of(
      [{ pooled: primary, direct: primary, replica: unreachable }],
      resolver,
    );
    const shards = new ShardScope();
    const probe = new RecoveryProbe(cluster, new TransactionScope(), shards);

    expect(await probe.inRecovery()).toBe(false);
    expect(await shards.within({ key: null, node: 0 }, () => probe.inRecovery())).toBe(false);
  });
});
