import { Identifiers, type OrganizationId } from "@loadbearing/contracts";
import { Uuid } from "@loadbearing/core";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "../../src/pg/primitive/index.js";
import { DatabaseCluster } from "../../src/pg/primitive/index.js";
import { PgMaintenanceGateway } from "../../src/pg/repository/pg-maintenance.gateway.js";
import { organizations, spareTenants } from "../../src/pg/schema/index.js";
import { TenantPartitionSeed } from "../../src/pg/seed/index.js";
import { PgUnitOfWork, ShardScope, TransactionScope } from "../../src/pg/transaction/index.js";
import { openDatabase } from "../support/database.js";

// One node, so nothing is ever placed: every repository here resolves to it.
const shards = new ShardScope();

let database: Database;
let gateway: PgMaintenanceGateway;
let seed: TenantPartitionSeed;

const founded: OrganizationId[] = [];

const tenant = async (): Promise<OrganizationId> => {
  const organizationId = Identifiers.organizationId.parse(Uuid.v7());
  await database.client
    .insert(organizations)
    .values({ id: organizationId, slug: `orphan-${organizationId}`, name: "Orphan" });
  await seed.run(organizationId);
  founded.push(organizationId);
  return organizationId;
};

beforeAll(async () => {
  database = openDatabase();
  const scope = new TransactionScope();
  const cluster = DatabaseCluster.single(database);

  seed = new TenantPartitionSeed(cluster, scope, shards);
  gateway = new PgMaintenanceGateway(
    cluster,
    scope,
    shards,
    new PgUnitOfWork(cluster, scope, shards, "catalog"),
  );
});

afterAll(async () => {
  for (const organizationId of founded) {
    await gateway.dropTenantPartitions(organizationId);
    await database.client.delete(organizations).where(eq(organizations.id, organizationId));
  }

  await database.close();
});

// `24.1` dropped the ten keys that made a leaked row impossible, so this read is the
// guarantee that replaced them. It runs nightly and its silence is the healthy answer.
describe("PgMaintenanceGateway.orphanedTenants", () => {
  // The whole point: a tenant with partitions and a live `organizations` row is not an
  // orphan, however many other tenants the node holds.
  it("does not name a tenant whose organization row is there", async () => {
    const live = await tenant();

    expect(await gateway.orphanedTenants()).not.toContain(live);
  });

  // The failure it exists to find: partitions left behind by a delete that did not
  // finish. Before `24.1` the database refused to let this happen at all.
  it("names a tenant whose partitions outlived its organization row", async () => {
    const abandoned = await tenant();
    await database.client.delete(organizations).where(eq(organizations.id, abandoned));

    expect(await gateway.orphanedTenants()).toContain(abandoned);

    // Put it back, so the shared teardown can drop the partitions the normal way.
    await database.client
      .insert(organizations)
      .values({ id: abandoned, slug: `orphan-${abandoned}`, name: "Orphan" });
  });

  // The id is rebuilt from the partition suffix, which carries no dashes. A reader that
  // compared the hex against `organizations.id` would find nothing and call it an orphan.
  it("reports an id the catalog can be queried with", async () => {
    const abandoned = await tenant();
    await database.client.delete(organizations).where(eq(organizations.id, abandoned));

    const orphans = await gateway.orphanedTenants();
    const found = orphans.find((id) => id === abandoned);

    expect(found, `${abandoned} not among ${orphans.length} orphans`).toBeDefined();
    expect(found).toMatch(/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/);

    await database.client
      .insert(organizations)
      .values({ id: abandoned, slug: `orphan-${abandoned}`, name: "Orphan" });
  });
});

// `PF.3`: a spare has partitions and no organization on purpose, so the nightly count
// must not call it a leak, and the top-up must make exactly what the pool is short.
describe("PgMaintenanceGateway.topUpSpareTenants", () => {
  it("makes what the pool is short, seeds each, and is not an orphan", async () => {
    const before = await database.client.select({ id: spareTenants.id }).from(spareTenants);

    expect(await gateway.topUpSpareTenants(before.length + 2)).toBe(2);
    expect(await gateway.topUpSpareTenants(before.length + 2)).toBe(0);

    const after = await database.client.select({ id: spareTenants.id }).from(spareTenants);
    const made = after
      .map((row) => row.id)
      .filter((id) => !before.some((row) => row.id === id)) as OrganizationId[];
    expect(made).toHaveLength(2);

    try {
      const orphans = await gateway.orphanedTenants();
      for (const id of made) {
        expect(orphans).not.toContain(id);
        expect(await seed.missing([id])).toEqual([]);
      }
    } finally {
      for (const id of made) {
        await database.client.delete(spareTenants).where(eq(spareTenants.id, id));
        await gateway.dropTenantPartitions(id);
      }
    }
  });
});
