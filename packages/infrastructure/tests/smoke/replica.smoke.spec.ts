import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { type Placement, sql, Uuid } from "../../src/import.js";
import { BaseRepository, Database, DatabaseCluster } from "../../src/pg/primitive/index.js";
import { ShardScope, TransactionScope } from "../../src/pg/transaction/index.js";
import type {} from "./support/stack.js";

const stack = inject("stack");
const standby = stack.replica;

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

// `24.3`: node 0's streaming standby, under `pnpm infra:up:replica`.
describe.skipIf(!standby)("a read replica for node 0", () => {
  // `skipIf` skips the tests, not this body, so the guard keeps a skipped run from
  // opening pools nothing will close.
  if (!standby) return;

  const primary = new Database({ url: stack.database.url });
  const direct = new Database({ url: stack.database.directUrl });
  const replica = new Database({ url: standby.url });
  const resolver = {
    resolve: () => Promise.resolve(0),
    placementOf: () => Promise.resolve({ node: 0, frozen: false }),
    invalidate: () => Promise.resolve(),
  };
  const cluster = DatabaseCluster.of([{ pooled: primary, direct, replica }], resolver);

  // Polled with a pause, because another spec's writes keep the standby a step behind.
  // A boolean, never the pool: a failing `toBe` on a pool prints it, and that is the heap.
  const replicaChosen = async (): Promise<boolean> => {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if ((await cluster.readerAt(0)) === replica) return true;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return false;
  };
  const table = `replica_probe_${Uuid.v7().replaceAll("-", "")}`;

  beforeAll(async () => {
    await direct.client.execute(sql.raw(`create table ${table} (id uuid primary key)`));
  });

  afterAll(async () => {
    await direct.client.execute(sql.raw(`drop table if exists ${table}`));
    await Promise.all([primary.close(), direct.close(), replica.close()]);
  });

  it("is a standby, and the cluster uses it once it has caught up", async () => {
    const found = await replica.client.execute<{ standby: boolean }>(
      sql`select pg_is_in_recovery() as standby`,
    );
    expect(found.rows[0]?.standby).toBe(true);

    expect(await replicaChosen()).toBe(true);
  });

  // **The whole guarantee.** A row committed on the primary is found by the next read,
  // whichever server answers it: the replica only when it has replayed that commit.
  // ──
  // Both halves per row: the read straight after the commit, which the primary usually
  // answers, and the first one the replica is chosen for, which must have the row too.
  it("never answers a read with less than the primary had when it began", async () => {
    const find = async (reader: Database, id: string) =>
      (await reader.client.execute(sql`select 1 from ${sql.identifier(table)} where id = ${id}`))
        .rows.length;

    for (let n = 0; n < 50; n += 1) {
      const id = Uuid.v7();
      await primary.client.execute(sql`insert into ${sql.identifier(table)} (id) values (${id})`);

      expect(await find(await cluster.readerAt(0), id), `row ${n}, first read`).toBe(1);

      expect(await replicaChosen(), `row ${n}: the replica was never chosen`).toBe(true);
      expect(await find(replica, id), `row ${n}, from the replica`).toBe(1);
    }
  });

  it("reports the standby healthy with its lag", async () => {
    const [health] = await cluster.replicaHealth();

    expect(health?.node).toBe(0);
    expect(health?.healthy).toBe(true);
    expect(health?.lagSeconds).toBeGreaterThanOrEqual(0);
  });

  it("routes a repository read to it only with the switch on and no transaction open", async () => {
    const shards = new ShardScope();
    const scope = new TransactionScope();
    const probe = new RecoveryProbe(cluster, scope, shards);

    const switchedOn = () =>
      shards.within({ key: null, node: 0, replica: true }, () => probe.inRecovery());

    let routed = false;
    for (let attempt = 0; attempt < 100 && !routed; attempt += 1) {
      routed = await switchedOn();
      if (!routed) await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(routed).toBe(true);

    expect(await shards.within({ key: null, node: 0 }, () => probe.inRecovery())).toBe(false);

    // Inside a transaction a read is the transaction's, whatever the switch says.
    const inside = await shards.within({ key: null, node: 0, replica: true }, () =>
      primary.client.transaction((tx) => scope.within(tx, "local", () => probe.inRecovery())),
    );
    expect(inside).toBe(false);
  });
});
