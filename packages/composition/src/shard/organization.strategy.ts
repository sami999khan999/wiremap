import type { Principal } from "../import.js";
import { Shard, ShardingStrategy, type ShardKey } from "../import.js";

// **The fork's swap point.** The organization is the shard (decision D28), so the
// shipped one is one line: a deployment sharding on region or plan edits this file.
export class OrganizationShardingStrategy extends ShardingStrategy {
  public override keyOf(principal: Principal): ShardKey {
    return Shard.keyOf(principal.organizationId);
  }
}
