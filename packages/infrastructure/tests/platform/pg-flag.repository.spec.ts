import { Identifiers, type OrganizationId } from "@loadbearing/contracts";
import { Uuid } from "@loadbearing/core";
import { eq, inArray } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { DatabaseCluster } from "../../src/pg/primitive/index.js";
import { PgFlagRepository } from "../../src/pg/repository/pg-flag.repository.js";
import { featureFlags, organizations } from "../../src/pg/schema/index.js";
import { ShardScope, TransactionScope } from "../../src/pg/transaction/index.js";
import { openDatabase } from "../support/database.js";

// Counted, so "one statement" is a fact the spec checks rather than a comment's claim.
let statements = 0;
const database = openDatabase({ logQuery: () => (statements += 1) });
const flags = new PgFlagRepository(
  DatabaseCluster.single(database),
  new TransactionScope(),
  new ShardScope(),
);

const actor = Identifiers.userId.parse(Uuid.v7());
// Per run, so an aborted run leaves rows nothing else will ever read as a real flag.
const run = Uuid.v7();
const KEY = `spec.${run}`;
const OTHER_KEY = `spec.other.${run}`;

const tenant = async (slug: string): Promise<OrganizationId> => {
  const id = Identifiers.organizationId.parse(Uuid.v7());
  await database.client.insert(organizations).values({ id, slug: `${slug}-${id}`, name: slug });
  return id;
};

const mine = async () => (await flags.findAll()).filter((row) => row.key.endsWith(run));

const created: OrganizationId[] = [];

afterAll(async () => {
  await database.client.delete(featureFlags).where(inArray(featureFlags.key, [KEY, OTHER_KEY]));
  if (created.length > 0) {
    await database.client.delete(organizations).where(inArray(organizations.id, created));
  }
  await database.close();
});

describe("PgFlagRepository", () => {
  it("has no row for a flag nobody has switched", async () => {
    expect(await mine()).toEqual([]);
  });

  it("switches a flag on and off, and records who", async () => {
    await flags.save(KEY, true, actor);
    expect(await mine()).toMatchObject([{ key: KEY, isEnabled: true, targets: [] }]);

    await flags.save(KEY, false, actor);
    const [row] = await database.client
      .select()
      .from(featureFlags)
      .where(eq(featureFlags.key, KEY));
    expect(row).toMatchObject({ isEnabled: false, updatedBy: actor });
  });

  // The first targeted rollout of a new flag has no row to hang a target on.
  it("creates the flag row, off, when the first target arrives", async () => {
    const acme = await tenant("acme");
    created.push(acme);

    await flags.saveTarget(OTHER_KEY, acme, actor);
    await flags.saveTarget(OTHER_KEY, acme, actor);

    const row = (await mine()).find((flag) => flag.key === OTHER_KEY);
    expect(row?.isEnabled).toBe(false);
    expect(row?.targets).toEqual([{ organizationId: acme, slug: `acme-${acme}` }]);
  });

  it("returns every target of every flag in one statement, sorted by slug", async () => {
    const zeta = await tenant("zeta");
    const alpha = await tenant("alpha");
    created.push(zeta, alpha);
    await flags.saveTarget(KEY, zeta, actor);
    await flags.saveTarget(KEY, alpha, actor);

    statements = 0;
    const row = (await flags.findAll()).find((flag) => flag.key === KEY);

    expect(statements).toBe(1);
    expect(row?.targets.map((target) => target.organizationId)).toEqual([alpha, zeta]);
  });

  it("removes one target and leaves the rest", async () => {
    const [first, second] = (await mine()).find((flag) => flag.key === KEY)?.targets ?? [];
    if (!first || !second) throw new Error("the previous case staged two targets");

    await flags.deleteTarget(KEY, first.organizationId);

    expect((await mine()).find((flag) => flag.key === KEY)?.targets).toEqual([second]);
  });

  // The cascade from the tenant side is `tenant-cascade.spec.ts`'s. This is the other one.
  it("takes a flag's targets with it when the flag row is deleted", async () => {
    await database.client.delete(featureFlags).where(eq(featureFlags.key, OTHER_KEY));

    expect((await mine()).map((flag) => flag.key)).toEqual([KEY]);
  });
});
