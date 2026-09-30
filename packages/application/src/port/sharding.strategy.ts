import type { Principal, ShardKey } from "../primitive/index.js";

// How a request is placed. Runs once per request after the principal is built, and
// once per job in the worker — never per query, which is what keeps it cheap.
export abstract class ShardingStrategy {
  // The organization is the shard (decision D28), so the shipped one is one line. It
  // is a port anyway because a fork sharding on region or plan edits one file.
  public abstract keyOf(principal: Principal): ShardKey;
}
