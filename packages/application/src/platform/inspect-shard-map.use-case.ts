import type { PaginationQuery } from "../import.js";
import type { Authorizer, Principal } from "../primitive/index.js";
import type { ShardMapReader, ShardNode, ShardTenant } from "./shard-map.reader.js";

// Two words rather than a boolean. `movesEnabled: false` reads as a switch somebody
// turned off; this is a mechanism that has not been built.
export type ShardMoves = "unavailable" | "available";

export interface InspectShardMapInput extends PaginationQuery {
  // Absent is the node list on its own. Present expands one node, which is what the
  // screen asks for on a click.
  readonly node?: number;
}

export interface ShardMap {
  readonly nodes: readonly ShardNode[];
  readonly tenants: readonly ShardTenant[];
  readonly total: number;
  readonly limit: number;
  readonly offset: number;
  readonly moves: ShardMoves;
}

export class InspectShardMapUseCase {
  public constructor(
    private readonly authorizer: Authorizer,
    private readonly shardMap: ShardMapReader,
    // Whether a move job is registered. Constant until `24.2`, and it is here rather
    // than on the screen so the retrofit is one line in the container.
    private readonly movesAvailable: boolean,
  ) {}

  public async execute(actor: Principal, input: InspectShardMapInput): Promise<ShardMap> {
    this.authorizer.assert(actor, "platform.shards.read");

    const nodes = await this.shardMap.nodes();
    // Two reads only when a node is named. The node list is small — one row per
    // physical node — and expanding one is what costs a scan of the directory.
    const page =
      input.node === undefined
        ? { items: [], total: 0 }
        : await this.shardMap.tenantsOn(input.node, input);

    return {
      nodes,
      tenants: page.items,
      total: page.total,
      limit: input.limit,
      offset: input.offset,
      moves: this.movesAvailable ? "available" : "unavailable",
    };
  }
}
