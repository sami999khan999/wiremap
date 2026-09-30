import { type DrizzleLogger, drizzle, type NodePgDatabase, Pool } from "../../import.js";
import * as schema from "../schema/index.js";

export interface DatabaseConfig {
  readonly url: string;
  readonly maxConnections?: number;
  readonly statementTimeoutMs?: number;
  readonly idleTimeoutMs?: number;
  readonly connectionTimeoutMs?: number;
  // Which process holds a connection, read back from `pg_stat_activity`. The one startup
  // parameter a transaction pooler forwards rather than dropping.
  readonly applicationName?: string;
  // Every statement, as drizzle issues it. This is the seam the query-count
  // assertions need — "four queries" is a claim that decays silently without one.
  readonly logger?: DrizzleLogger;
  // Where a dead *idle* connection goes. Never optional in effect: see the listener below.
  readonly onError?: (error: Error) => void;
}

// What `Container.health()` reports. `max` travels with the three counts because a
// `waiting` of one means nothing without the ceiling it is waiting for.
export interface DatabaseStats {
  readonly total: number;
  readonly idle: number;
  readonly waiting: number;
  readonly max: number;
}

// The handle every repository queries through, pool or open transaction alike.
// Named so BaseRepository and TransactionScope agree on one type.
export type DrizzleClient = NodePgDatabase<typeof schema>;

// The one place a pool is configured. Defaults live here rather than in `ContainerConfig`,
// so a script that writes `new Database({ url })` gets the same pool the apps get.
export class Database {
  private static readonly MAX_CONNECTIONS = 10;
  private static readonly STATEMENT_TIMEOUT_MS = 30_000;
  private static readonly IDLE_TIMEOUT_MS = 30_000;
  // Not the OS default, which is minutes: an unreachable Postgres should fail a request,
  // not hold it open past every timeout upstream of it.
  private static readonly CONNECT_TIMEOUT_MS = 5_000;
  // The forgotten-`await` guard, and the floor `S1.7`'s role setting repeats server-side
  // for pooled connections, which never receive this one.
  private static readonly IDLE_IN_TRANSACTION_TIMEOUT_MS = 60_000;

  private readonly pool: Pool;
  private readonly max: number;
  public readonly client: DrizzleClient;

  public constructor(config: DatabaseConfig) {
    this.max = config.maxConnections ?? Database.MAX_CONNECTIONS;
    this.pool = new Pool({
      connectionString: config.url,
      max: this.max,
      // Not optional. Without it one accidental cross join holds a connection
      // until somebody notices, and a pool of ten is the whole application.
      statement_timeout: config.statementTimeoutMs ?? Database.STATEMENT_TIMEOUT_MS,
      idle_in_transaction_session_timeout: Database.IDLE_IN_TRANSACTION_TIMEOUT_MS,
      idleTimeoutMillis: config.idleTimeoutMs ?? Database.IDLE_TIMEOUT_MS,
      connectionTimeoutMillis: config.connectionTimeoutMs ?? Database.CONNECT_TIMEOUT_MS,
      application_name: config.applicationName,
    });

    // Registered unconditionally, and that is the point: `pg` emits this on an **idle**
    // client whose socket died, where no caller is waiting and nothing else can catch it.
    this.pool.on("error", (error: Error) => config.onError?.(error));

    this.client = drizzle(this.pool, { schema, logger: config.logger });
  }

  // Off the live pool rather than counted here: `pg.Pool` already owns these, and a
  // second tally is one that drifts. Blind to the pooler in front — see the reference page.
  public stats(): DatabaseStats {
    return {
      total: this.pool.totalCount,
      idle: this.pool.idleCount,
      waiting: this.pool.waitingCount,
      max: this.max,
    };
  }

  public async isHealthy(): Promise<boolean> {
    try {
      await this.pool.query("SELECT 1");
      return true;
    } catch {
      return false;
    }
  }

  public async close(): Promise<void> {
    await this.pool.end();
  }
}
