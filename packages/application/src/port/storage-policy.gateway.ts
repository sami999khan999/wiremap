// A colder class the bucket can move an object to, and after how many days — `25.3`.
// On AWS a class such as `GLACIER`; on MinIO the name of a configured remote tier.
export interface ColdTier {
  readonly storageClass: string;
  readonly afterDays: number;
}

// One prefix, one expiry, and at most one transition. Narrower than what S3 can express
// on purpose: "everything under this prefix, colder after M days, gone after N".
export interface LifecycleRule {
  readonly prefix: string;
  readonly expireAfterDays: number;
  readonly transition?: ColdTier;
}

// A second port rather than a method on `StorageGateway`: that one says "no bucket, no
// region, no endpoint", and a lifecycle rule is bucket-shaped policy.
export abstract class StoragePolicyGateway {
  // A bucket with no configuration reads as `[]`. `NoSuchLifecycleConfiguration` is the
  // empty case, not an error, and a caller that treated it as one would never converge.
  public abstract lifecycle(): Promise<readonly LifecycleRule[]>;

  // **Replaces the whole configuration.** S3 offers no per-rule write, which is why the
  // composer takes every row and why a failed call has to self-heal on the next run.
  public abstract applyLifecycle(rules: readonly LifecycleRule[]): Promise<void>;

  // The deployment's colder class, or null for none. The bucket's, so the gateway that
  // writes its rules is the one that knows which classes it has.
  public abstract coldTier(): ColdTier | null;
}
