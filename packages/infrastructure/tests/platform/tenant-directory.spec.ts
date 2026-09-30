import { Identifiers, type OrganizationId } from "@loadbearing/contracts";
import { Uuid } from "@loadbearing/core";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { DatabaseCluster } from "../../src/pg/primitive/index.js";
import { PgTenantRepository } from "../../src/pg/repository/pg-tenant.repository.js";
import { organizations, shardAssignments } from "../../src/pg/schema/index.js";
import { ShardScope, TransactionScope } from "../../src/pg/transaction/index.js";
import { openDatabase } from "../support/database.js";

const database = openDatabase();
const cluster = DatabaseCluster.single(database);
const tenants = new PgTenantRepository(cluster, new TransactionScope(), new ShardScope());

const organizationId = Identifiers.organizationId.parse(Uuid.v7()) as OrganizationId;

const directoryRows = async () =>
  database.client
    .select({ node: shardAssignments.node })
    .from(shardAssignments)
    .where(eq(shardAssignments.shardKey, organizationId));

beforeEach(async () => {
  await database.client
    .insert(organizations)
    .values({ id: organizationId, slug: `directory-${organizationId}`, name: "Directory" })
    .onConflictDoNothing();

  await database.client
    .insert(shardAssignments)
    .values({ shardKey: organizationId, node: 0 })
    .onConflictDoNothing();
});

afterAll(async () => {
  await database.client
    .delete(shardAssignments)
    .where(eq(shardAssignments.shardKey, organizationId));
  await database.client.delete(organizations).where(eq(organizations.id, organizationId));
  await database.close();
});

describe("PgTenantRepository.delete", () => {
  // The directory carries no foreign key, so nothing cascades into it. Without this the
  // table grows with tenant churn forever and the move job scans rows nobody owns.
  it("takes the tenant's directory row with it", async () => {
    expect(await directoryRows()).toHaveLength(1);

    await tenants.delete(organizationId);

    expect(await directoryRows()).toHaveLength(0);
    expect(await tenants.findBy(organizationId)).toBeNull();
  });

  it("is a no-op for a tenant already gone, which is what makes a retry safe", async () => {
    await tenants.delete(organizationId);
    await tenants.delete(organizationId);

    expect(await directoryRows()).toHaveLength(0);
  });
});
