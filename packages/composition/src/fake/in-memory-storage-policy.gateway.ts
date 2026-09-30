import { type ColdTier, type LifecycleRule, StoragePolicyGateway } from "../import.js";

// Rules in a field, and `applyLifecycle` **replaces** them — the same semantics S3 has,
// because a fake that merged would let a caller that drops a rule pass.
export class InMemoryStoragePolicyGateway extends StoragePolicyGateway {
  private rules: readonly LifecycleRule[] = [];
  private readonly writes: (readonly LifecycleRule[])[] = [];

  public constructor(private readonly tier: ColdTier | null = null) {
    super();
  }

  public override coldTier(): ColdTier | null {
    return this.tier;
  }

  public override lifecycle(): Promise<readonly LifecycleRule[]> {
    return Promise.resolve(this.rules);
  }

  public override applyLifecycle(rules: readonly LifecycleRule[]): Promise<void> {
    this.rules = rules;
    this.writes.push(rules);
    return Promise.resolve();
  }

  // How many times the whole configuration was rewritten, which is the number that
  // matters: the daily job is supposed to write on difference and not on every run.
  public applied(): readonly (readonly LifecycleRule[])[] {
    return this.writes;
  }
}
