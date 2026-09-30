import { Identifiers, type OrganizationId } from "@loadbearing/contracts";
import { Uuid } from "@loadbearing/core";
import { eq, inArray, type Logger } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DatabaseCluster } from "../../src/pg/primitive/index.js";
import { PgShardMapReader } from "../../src/pg/repository/pg-shard-map.reader.js";
import {
  organizations,
  shardAssignments,
  tenantRetentionPolicy,
} from "../../src/pg/schema/index.js";
import { ShardScope, TransactionScope } from "../../src/pg/transaction/index.js";
import { openDatabase } from "../support/database.js";

// Captures the SQL the reader actually issued, so the statement-count assertion below is
// against the query under test rather than a copy of it that can drift.
class RecordingQueryLogger implements Logger {
  public readonly queries: string[] = [];

  public logQuery(query: string): void {
    this.queries.push(query);
  }
}

const recorder = new RecordingQueryLogger();
const database = openDatabase(recorder);
const cluster = DatabaseCluster.single(database);
const reader = new PgShardMapReader(cluster, new TransactionScope(), new ShardScope());

// Two tenants on node 0, one of them with a retention override, so the count column has
// both answers in one page rather than only the interesting one.
const plain = Identifiers.organizationId.parse(Uuid.v7()) as OrganizationId;
const overridden = Identifiers.organizationId.parse(Uuid.v7()) as OrganizationId;
const ids = [plain, overridden];

const slugOf = (id: OrganizationId) => `shard-map-${id}`;

beforeAll(async () => {
  await database.client.insert(organizations).values([
    { id: plain, slug: slugOf(plain), name: "Shard map — plain" },
    { id: overridden, slug: slugOf(overridden), name: "Shard map — overridden" },
  ]);

  await database.client.insert(shardAssignments).values([
    { shardKey: plain, node: 0 },
    { shardKey: overridden, node: 0 },
  ]);

  await database.client
    .insert(tenantRetentionPolicy)
    .values({ organizationId: overridden, tableName: "activity_log", hotMonths: 3 });
});

afterAll(async () => {
  await database.client
    .delete(tenantRetentionPolicy)
    .where(inArray(tenantRetentionPolicy.organizationId, ids));
  await database.client.delete(shardAssignments).where(inArray(shardAssignments.shardKey, ids));
  await database.client.delete(organizations).where(inArray(organizations.id, ids));
  await database.close();
});

describe("PgShardMapReader.nodes", () => {
  it("counts the directory, one row per physical node", async () => {
    const nodes = await reader.nodes();
    const zero = nodes.find((node) => node.node === 0);

    expect(zero).toBeDefined();
    expect(zero?.tenants).toBeGreaterThanOrEqual(2);
    expect(zero?.lastAssignedAt).toBeInstanceOf(Date);
  });

  // Not a zero date. A node nothing has ever moved to has no such date, and inventing
  // one reads as a move that happened.
  it("leaves `lastMovedAt` null on a node nothing has been moved to", async () => {
    const moved = await database.client
      .select({ movedAt: shardAssignments.movedAt })
      .from(shardAssignments)
      .where(eq(shardAssignments.shardKey, plain));

    expect(moved[0]?.movedAt).toBeNull();
  });
});

describe("PgShardMapReader.tenantsOn", () => {
  it("returns a node's tenants with their retention override count", async () => {
    const page = await reader.tenantsOn(0, { limit: 100, offset: 0 });
    const rows = page.items.filter((row) => ids.includes(row.organizationId));

    expect(rows).toHaveLength(2);
    expect(rows.find((row) => row.organizationId === plain)?.retentionOverrides).toBe(0);
    expect(rows.find((row) => row.organizationId === overridden)?.retentionOverrides).toBe(1);
    expect(page.total).toBeGreaterThanOrEqual(2);
  });

  // The scalar subquery is per row and the page is bounded by `limit`, so the statement
  // count must not move with the number of tenants on the page.
  it("costs two statements whatever the page holds", async () => {
    recorder.queries.length = 0;
    await reader.tenantsOn(0, { limit: 100, offset: 0 });
    const wide = recorder.queries.length;

    recorder.queries.length = 0;
    await reader.tenantsOn(0, { limit: 1, offset: 0 });

    expect(wide).toBe(2);
    expect(recorder.queries.length).toBe(2);
  });

  it("has no rows for a node nothing was placed on", async () => {
    const page = await reader.tenantsOn(97, { limit: 25, offset: 0 });

    expect(page.items).toEqual([]);
    expect(page.total).toBe(0);
  });
});

describe("PgShardMapReader.findByTerm", () => {
  it("finds a tenant by its organization id", async () => {
    const found = await reader.findByTerm(plain);

    expect(found?.slug).toBe(slugOf(plain));
    expect(found?.node).toBe(0);
  });

  it("finds the same tenant by its slug", async () => {
    const found = await reader.findByTerm(slugOf(overridden));

    expect(found?.organizationId).toBe(overridden);
    expect(found?.retentionOverrides).toBe(1);
  });

  // A slug cast to a uuid would be a `22P02` from the database rather than the empty
  // answer a typed search should get, which is why the comparison casts the other way.
  it("answers null for a term that is neither, rather than throwing", async () => {
    expect(await reader.findByTerm("not-a-uuid-and-not-a-slug")).toBeNull();
  });
});
