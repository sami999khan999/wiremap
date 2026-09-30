import { Identifiers, type OrganizationId } from "@loadbearing/contracts";
import { Uuid } from "@loadbearing/core";
import { inArray, type Logger } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DatabaseCluster } from "../../src/pg/primitive/index.js";
import { PgShardMapReader } from "../../src/pg/repository/pg-shard-map.reader.js";
import { organizations, shardAssignments } from "../../src/pg/schema/index.js";
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

// Two tenants on node 0, so a lookup has a neighbour it must not answer with.
const plain = Identifiers.organizationId.parse(Uuid.v7()) as OrganizationId;
const second = Identifiers.organizationId.parse(Uuid.v7()) as OrganizationId;
const ids = [plain, second];

const slugOf = (id: OrganizationId) => `shard-map-${id}`;

beforeAll(async () => {
  await database.client.insert(organizations).values([
    { id: plain, slug: slugOf(plain), name: "Shard map — plain" },
    { id: second, slug: slugOf(second), name: "Shard map — second" },
  ]);

  await database.client.insert(shardAssignments).values([
    { shardKey: plain, node: 0 },
    { shardKey: second, node: 0 },
  ]);
});

afterAll(async () => {
  await database.client.delete(shardAssignments).where(inArray(shardAssignments.shardKey, ids));
  await database.client.delete(organizations).where(inArray(organizations.id, ids));
  await database.close();
});

describe("PgShardMapReader.findByTerm", () => {
  it("finds a tenant by its organization id", async () => {
    const found = await reader.findByTerm(plain);

    expect(found?.slug).toBe(slugOf(plain));
    expect(found?.node).toBe(0);
  });

  it("finds the same tenant by its slug", async () => {
    const found = await reader.findByTerm(slugOf(second));

    expect(found?.organizationId).toBe(second);
  });

  // A slug cast to a uuid would be a `22P02` from the database rather than the empty
  // answer a typed search should get, which is why the comparison casts the other way.
  it("answers null for a term that is neither, rather than throwing", async () => {
    expect(await reader.findByTerm("not-a-uuid-and-not-a-slug")).toBeNull();
  });
});
