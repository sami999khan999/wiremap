import {
  InternalError,
  type ShardKey,
  type ShardPlacement,
  type ShardResolver,
  sql,
} from "../../import.js";
import { Database, type DatabaseConfig } from "./database.js";

// One physical Postgres, pooled twice: through the pooler for everything, and directly
// for the DDL a transaction pooler cannot carry. See docs/infra/reference/pgbouncer.md.
export interface ShardConfig {
  readonly pooled: DatabaseConfig;
  readonly direct: DatabaseConfig;
  // A streaming standby of this node, for the reads that tolerate being routed off the
  // primary — `24.3`. Absent is every read on the primary, which is every deployment today.
  readonly replica?: DatabaseConfig;
}

// One node's standby as the status panel reads it. `lagSeconds` is null when the
// replica cannot be asked, which is what `healthy: false` means.
export interface ReplicaHealth {
  readonly node: number;
  readonly healthy: boolean;
  readonly lagSeconds: number | null;
}

// Node 0 for every key, which is what one node means.
const NODE_ZERO = {
  resolve: () => Promise.resolve(0),
  placementOf: () => Promise.resolve({ node: 0, frozen: false }),
  invalidate: () => Promise.resolve(),
} as ShardResolver;

// Every physical node, indexed. Node 0 is the catalog and it always exists; a
// deployment that has never sharded has exactly one entry and behaves as it always did.
export class DatabaseCluster {
  private constructor(
    private readonly nodes: readonly Database[],
    private readonly directNodes: readonly Database[],
    private readonly replicas: readonly (Database | undefined)[],
    private readonly resolver: ShardResolver,
  ) {}

  // **The only place in `src/` that writes `new Database(`** — §23 asserts it. A second
  // one is a pool nothing closes and nothing counts.
  public static from(shards: readonly ShardConfig[], resolver: ShardResolver): DatabaseCluster {
    return DatabaseCluster.of(
      shards.map((shard) => ({
        pooled: new Database(shard.pooled),
        direct: new Database(shard.direct),
        replica: shard.replica ? new Database(shard.replica) : undefined,
      })),
      resolver,
    );
  }

  // Already-open pools, shared rather than reopened, which keeps `close()` honest. The
  // one factory that reaches the constructor: what a node carries is declared once.
  public static of(
    nodes: readonly {
      readonly pooled: Database;
      readonly direct: Database;
      readonly replica?: Database | undefined;
    }[],
    resolver: ShardResolver,
  ): DatabaseCluster {
    if (nodes.length === 0) throw new InternalError(new Error("A cluster needs one shard."));

    return new DatabaseCluster(
      nodes.map((node) => node.pooled),
      nodes.map((node) => node.direct),
      nodes.map((node) => node.replica),
      resolver,
    );
  }

  // `of` with the resolver that answers node 0 for every key, which is what an
  // unsharded deployment is. One `direct` argument means DDL shares the pooled handle.
  public static single(database: Database, direct?: Database): DatabaseCluster {
    return DatabaseCluster.of([{ pooled: database, direct: direct ?? database }], NODE_ZERO);
  }

  // Node 0, always. The catalog is the last single primary and §4 files what to do
  // about that; until then, "which node is the catalog" is not a question.
  public catalog(): Database {
    return this.at(0);
  }

  public directCatalog(): Database {
    return this.directAt(0);
  }

  // The node a key's rows are on — `forKey`'s answer before it picks the pool.
  public async nodeOf(key: ShardKey): Promise<number> {
    return this.resolver.resolve(key);
  }

  // The node and the freeze, cached beside each other — what a rechecked job
  // transaction compares its placement against.
  public async placementOf(key: ShardKey): Promise<ShardPlacement> {
    return this.resolver.placementOf(key);
  }

  public async forKey(key: ShardKey): Promise<Database> {
    return this.at(await this.resolver.resolve(key));
  }

  public async directForKey(key: ShardKey): Promise<Database> {
    return this.directAt(await this.resolver.resolve(key));
  }

  // Every node, for the cross-tenant loops: the migrator, the seed, the partition pass,
  // the outbox drain. One node today, which is what makes the loop cheap to write now.
  public each(): readonly Database[] {
    return this.nodes;
  }

  public eachDirect(): readonly Database[] {
    return this.directNodes;
  }

  public get size(): number {
    return this.nodes.length;
  }

  // **The replica only once it has replayed everything the primary had when the read
  // began**, the primary otherwise, so no caller reasons about lag — see sharding.md.
  public async readerAt(node: number): Promise<Database> {
    const primary = this.at(node);
    const replica = this.replicas[node];
    if (!replica) return primary;

    try {
      const head = await primary.client.execute<{ lsn: string }>(
        sql`select pg_current_wal_lsn()::text as lsn`,
      );
      const lsn = head.rows[0]?.lsn;
      if (!lsn) return primary;

      const replayed = await replica.client.execute<{ caught: boolean }>(
        sql`select coalesce(pg_last_wal_replay_lsn() >= ${lsn}::pg_lsn, false) as caught`,
      );
      return replayed.rows[0]?.caught === true ? replica : primary;
    } catch {
      // A standby that is down is a slower read, never a failed one. The status panel
      // is where an unreachable replica shows, not the job that happened to ask.
      return primary;
    }
  }

  public async reader(key: ShardKey): Promise<Database> {
    return this.readerAt(await this.resolver.resolve(key));
  }

  public get hasReplicas(): boolean {
    return this.replicas.some((replica) => replica !== undefined);
  }

  // Lag as the time since the last replayed commit, **zero when nothing is waiting**:
  // an idle primary sends nothing, and a replay timestamp alone would read as lag.
  public async replicaHealth(): Promise<readonly ReplicaHealth[]> {
    const probes = this.replicas.map(async (replica, node) => {
      if (!replica) return null;
      try {
        const found = await replica.client.execute<{ lag: number | null }>(sql`
          select case
            when pg_last_wal_receive_lsn() = pg_last_wal_replay_lsn() then 0
            else extract(epoch from now() - pg_last_xact_replay_timestamp())
          end::float8 as lag
        `);
        const lag = found.rows[0]?.lag ?? null;
        return { node, healthy: true, lagSeconds: lag === null ? null : Math.max(0, lag) };
      } catch {
        return { node, healthy: false, lagSeconds: null };
      }
    });

    return (await Promise.all(probes)).filter((probe) => probe !== null);
  }

  // Per shard rather than one boolean: "the database is down" is a different page from
  // "shard 2 is down", and a single flag cannot tell them apart.
  public async isHealthy(): Promise<Readonly<Record<number, boolean>>> {
    const results = await Promise.all(this.nodes.map((node) => node.isHealthy()));
    return Object.fromEntries(results.map((healthy, index) => [index, healthy]));
  }

  public async close(): Promise<void> {
    const standbys = this.replicas.filter((replica) => replica !== undefined);
    const pools = new Set([...this.nodes, ...this.directNodes, ...standbys]);
    await Promise.all([...pools].map((node) => node.close()));
  }

  // An out-of-range node is an error rather than a fall back to zero: the directory
  // naming a node nobody deployed is a misconfiguration, and the wrong shard is worse.
  public at(node: number): Database {
    const database = this.nodes[node];
    if (!database) throw DatabaseCluster.unknown(node);
    return database;
  }

  public directAt(node: number): Database {
    const database = this.directNodes[node];
    if (!database) throw DatabaseCluster.unknown(node);
    return database;
  }

  private static unknown(node: number): InternalError {
    return new InternalError(new Error(`No shard is deployed at node ${node}.`));
  }
}
