import type { Authorizer, Principal } from "../primitive/index.js";
import type { ShardMoves } from "./inspect-shard-map.use-case.js";
import type { ShardMapReader, ShardTenant } from "./shard-map.reader.js";

export interface LocateTenantInput {
  // An organization id or a slug. The reader decides which by shape, because an
  // operator pasting one of the two should not have to say which they pasted.
  readonly term: string;
}

export interface TenantLocation {
  // Null is "nothing answers to that". A miss is what a typed search usually is, and
  // `NOT_FOUND` would make the screen render an error for normal typing.
  readonly tenant: ShardTenant | null;
  readonly moves: ShardMoves;
}

// Its own use-case rather than a field on the map: an operator typing a slug must not
// re-read the node list on every keystroke.
export class LocateTenantUseCase {
  public constructor(
    private readonly authorizer: Authorizer,
    private readonly shardMap: ShardMapReader,
    private readonly movesAvailable: boolean,
  ) {}

  public async execute(actor: Principal, input: LocateTenantInput): Promise<TenantLocation> {
    this.authorizer.assert(actor, "platform.shards.read");

    const tenant = await this.shardMap.findByTerm(input.term.trim());
    return { tenant, moves: this.movesAvailable ? "available" : "unavailable" };
  }
}
