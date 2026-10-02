import {
  DeleteBucketLifecycleCommand,
  GetBucketLifecycleConfigurationCommand,
  type LifecycleRule,
  PutBucketLifecycleConfigurationCommand,
  type S3Client,
  StoragePolicyGateway,
} from "../import.js";
import { S3ClientFactory } from "./s3-client.factory.js";
import type { S3Config } from "./s3-storage.gateway.js";

// What S3 answers for a bucket with no configuration. An **error code**, not an empty
// body — a caller that let it propagate would report drift forever and apply nothing.
const NO_CONFIGURATION = "NoSuchLifecycleConfiguration";

// A second gateway rather than methods on `S3StorageGateway`, because that class is
// about objects and this one is about the bucket. See docs/reference/storage-policy.md.
export class S3StoragePolicyGateway extends StoragePolicyGateway {
  private readonly s3: S3Client;

  public override readonly managesLifecycle: boolean;

  public constructor(private readonly config: S3Config) {
    super();
    this.s3 = S3ClientFactory.create(config);
    this.managesLifecycle = config.lifecycle !== false;
  }

  public async lifecycle(): Promise<readonly LifecycleRule[]> {
    try {
      const response = await this.s3.send(
        new GetBucketLifecycleConfigurationCommand({ Bucket: this.config.bucket }),
      );

      return (response.Rules ?? [])
        .filter((rule) => rule.Status === "Enabled")
        .flatMap((rule) => {
          const prefix = rule.Filter?.Prefix;
          const days = rule.Expiration?.Days;
          // A rule this system did not write — no prefix, or an expiry as a date — is
          // reported as absent. A transition is ignored: lite writes and compares none.
          if (!prefix || days === undefined) return [];
          return [{ prefix, expireAfterDays: days }];
        });
    } catch (error: unknown) {
      if (S3StoragePolicyGateway.isMissing(error)) return [];
      throw error;
    }
  }

  // **Replaces the whole configuration**, which is S3's only offer. An empty list
  // deletes it, the honest reading of "no row names a cold window".
  public async applyLifecycle(rules: readonly LifecycleRule[]): Promise<void> {
    // A `Put` with zero rules is `InvalidArgument`, not "no rules" — S3 and MinIO both
    // reject it. Deleting is what "no row names a cold window" actually means.
    if (rules.length === 0) {
      await this.s3.send(new DeleteBucketLifecycleCommand({ Bucket: this.config.bucket }));
      return;
    }

    await this.s3.send(
      new PutBucketLifecycleConfigurationCommand({
        Bucket: this.config.bucket,
        LifecycleConfiguration: {
          Rules: rules.map((rule) => ({
            // The prefix is the id, so two runs over the same rows produce the same
            // configuration and a diff of the bucket reads as a diff of the policy.
            ID: rule.prefix,
            Filter: { Prefix: rule.prefix },
            Status: "Enabled",
            Expiration: { Days: rule.expireAfterDays },
          })),
        },
      }),
    );
  }

  // The SDK puts the code on `name` for a modelled error and on `Code` for one it only
  // saw on the wire. MinIO answers the same code, so the local stack tests this path.
  private static isMissing(error: unknown): boolean {
    if (typeof error !== "object" || error === null) return false;
    const shape = error as { name?: string; Code?: string };
    return shape.name === NO_CONFIGURATION || shape.Code === NO_CONFIGURATION;
  }
}
