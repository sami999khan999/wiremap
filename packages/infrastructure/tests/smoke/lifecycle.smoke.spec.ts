import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import type { LifecycleRule } from "../../src/import.js";
import { S3StoragePolicyGateway } from "../../src/s3/index.js";
import type {} from "./support/stack.js";

const stack = inject("stack");
const tier = stack.coldTier;

// `25.3`: a lifecycle transition to a colder class, against MinIO with a remote tier
// registered under the `cold-tier` profile. MinIO has no classes of its own.
describe.skipIf(!tier)("a colder storage class on the running bucket", () => {
  if (!tier) return;

  const gateway = new S3StoragePolicyGateway({ ...stack.storage, coldTier: tier });
  // The bucket's real configuration, put back afterwards: `applyLifecycle` replaces the
  // whole thing, and a smoke run must not leave the nightly job something to repair.
  let before: readonly LifecycleRule[] = [];

  beforeAll(async () => {
    before = await gateway.lifecycle();
  });

  afterAll(async () => {
    await gateway.applyLifecycle(before);
  });

  it("writes a transition to the tier and reads the same rule back", async () => {
    const rules: readonly LifecycleRule[] = [
      { prefix: "cold/lifecycle-smoke/", expireAfterDays: 365, transition: tier },
      { prefix: "export/", expireAfterDays: 7 },
    ];

    await gateway.applyLifecycle(rules);

    const read = [...(await gateway.lifecycle())].sort((left, right) =>
      left.prefix.localeCompare(right.prefix),
    );
    expect(read).toEqual(rules);
  });

  // The tier is what makes the class mean something: MinIO validates the name, so a
  // class nobody registered fails the whole write rather than moving nothing quietly.
  it("refuses a class the bucket has no tier for", async () => {
    await expect(
      gateway.applyLifecycle([
        {
          prefix: "cold/lifecycle-smoke/",
          expireAfterDays: 365,
          transition: { storageClass: "NO_SUCH_TIER", afterDays: 30 },
        },
      ]),
    ).rejects.toThrow();
  });

  it("reports the configured tier as the one to compose with", () => {
    expect(gateway.coldTier()).toEqual(tier);
  });
});
