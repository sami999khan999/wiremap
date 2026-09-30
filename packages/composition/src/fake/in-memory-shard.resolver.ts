import { type ShardKey, type ShardPlacement, ShardResolver } from "../import.js";

// Node 0 for everything it was not told about, which is what an unsharded deployment
// answers. Records the invalidations, because a move that forgets one is the bug.
export class InMemoryShardResolver extends ShardResolver {
  private readonly nodes = new Map<ShardKey, number>();
  private readonly invalidated: ShardKey[] = [];
  // Frozen keys, not a second map of everything: a spec about the write freeze names
  // the tenant that is moving, and every other tenant is unaffected by construction.
  private readonly moving = new Set<ShardKey>();

  public place(key: ShardKey, node: number): void {
    this.nodes.set(key, node);
  }

  public freeze(key: ShardKey): void {
    this.moving.add(key);
  }

  public override resolve(key: ShardKey): Promise<number> {
    return Promise.resolve(this.nodes.get(key) ?? 0);
  }

  public override placementOf(key: ShardKey): Promise<ShardPlacement> {
    return Promise.resolve({ node: this.nodes.get(key) ?? 0, frozen: this.moving.has(key) });
  }

  public override invalidate(key: ShardKey): Promise<void> {
    this.invalidated.push(key);
    return Promise.resolve();
  }

  public flushed(): readonly ShardKey[] {
    return this.invalidated;
  }
}
