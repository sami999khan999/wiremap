import { PartitionArchiveGateway, PartitionedTable } from "@loadbearing/application";
import { Identifiers, type OrganizationId } from "@loadbearing/contracts";
import { Uuid } from "@loadbearing/core";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { StorageGateway } from "../../src/import.js";
import type { Database } from "../../src/pg/primitive/index.js";
import { DatabaseCluster } from "../../src/pg/primitive/index.js";
import { PgPartitionArchiveGateway } from "../../src/pg/repository/pg-partition-archive.gateway.js";
import { organizations, partitionArchive } from "../../src/pg/schema/index.js";
import { ShardScope, TransactionScope } from "../../src/pg/transaction/index.js";
import { openDatabase } from "../support/database.js";

// The spec `REVIEW.md` says would have caught both defects and did not exist. It writes
// `partition_archive` rows directly: the sweep's own predicate is the whole subject.
const shards = new ShardScope();
const placeOnTheOneNode = () => shards.enter({ key: "spec" as never, node: 0 });

beforeAll(placeOnTheOneNode);
beforeEach(placeOnTheOneNode);

const YEAR_AGO = new Date(Date.UTC(2031, 4, 1));
const DELETED_AT = new Date(Date.UTC(2032, 4, 1));
// Thirty-one days after the delete, which is the far side of the recovery window.
const AFTER_THE_WINDOW = new Date(Date.UTC(2032, 5, 1));

let database: Database;
let gateway: PgPartitionArchiveGateway;
let live: OrganizationId;
let gone: OrganizationId;

// Records what it was asked to delete. The sweep's contract is object-then-row, so a
// spec that did not watch the bucket could not tell a no-op from a deletion.
class RecordingStorage implements Partial<StorageGateway> {
  public readonly deleted: string[] = [];

  public delete(key: string): Promise<void> {
    this.deleted.push(key);
    return Promise.resolve();
  }
}

let storage: RecordingStorage;

const row = (
  organizationId: OrganizationId,
  tableName: string,
  archivedAt: Date,
  deletedAt: Date | null,
) =>
  database.client.insert(partitionArchive).values({
    organizationId,
    tableName,
    period: "2031-05-01",
    objectKey: `cold/${tableName}/2031/05/${organizationId}.ndjson.gz`,
    rowCount: 1,
    bytes: 1,
    checksum: "sha-1",
    archivedAt,
    deletedAt,
  });

const remaining = async (organizationId: OrganizationId) => {
  const found = await database.client
    .select({ key: partitionArchive.objectKey })
    .from(partitionArchive)
    .where(eq(partitionArchive.organizationId, organizationId));
  return found.length;
};

beforeAll(async () => {
  database = openDatabase();
  storage = new RecordingStorage();
  const scope = new TransactionScope();
  const cluster = DatabaseCluster.single(database);
  gateway = new PgPartitionArchiveGateway(
    cluster,
    scope,
    shards,
    storage as unknown as StorageGateway,
  );

  // One tenant that still exists and one that does not. The `organizations` row is the
  // second half of the predicate, so a spec with only deleted tenants cannot see it.
  live = Identifiers.organizationId.parse(Uuid.v7());
  gone = Identifiers.organizationId.parse(Uuid.v7());
  await database.client
    .insert(organizations)
    .values({ id: live, name: "Live", slug: `sweep-live-${live}` });
});

afterEach(async () => {
  storage.deleted.length = 0;
  for (const id of [live, gone, PartitionArchiveGateway.NO_TENANT]) {
    await database.client.delete(partitionArchive).where(eq(partitionArchive.organizationId, id));
  }
});

afterAll(async () => {
  await database.client.delete(organizations).where(eq(organizations.id, live));
  await database.close();
});

describe("PgPartitionArchiveGateway.sweepDeleted", () => {
  // The outbox has no tenant level, so its months sit under the nil uuid, which no
  // `organizations` row matches — every one was destroyed the night it aged out.
  it("leaves the outbox's tenant-less archives alone", async () => {
    await row(PartitionArchiveGateway.NO_TENANT, PartitionedTable.OUTBOX_EVENT, YEAR_AGO, null);

    const swept = await gateway.sweepDeleted(AFTER_THE_WINDOW);

    expect(swept.objects).toBe(0);
    expect(storage.deleted).toEqual([]);
    expect(await remaining(PartitionArchiveGateway.NO_TENANT)).toBe(1);
  });

  // `R.5`. A tenant with a year of cold months had every month but the two re-archived
  // at delete time already older than the window, so they went the very next night.
  it("keeps a month archived long before the delete for the whole window", async () => {
    await row(gone, PartitionedTable.ACTIVITY_LOG, YEAR_AGO, DELETED_AT);

    const swept = await gateway.sweepDeleted(DELETED_AT);

    expect(swept.objects).toBe(0);
    expect(await remaining(gone)).toBe(1);
  });

  it("sweeps that same month once the window has passed", async () => {
    await row(gone, PartitionedTable.ACTIVITY_LOG, YEAR_AGO, DELETED_AT);

    const swept = await gateway.sweepDeleted(AFTER_THE_WINDOW);

    expect(swept.objects).toBe(1);
    expect(swept.organizations).toBe(1);
    expect(storage.deleted).toHaveLength(1);
    expect(await remaining(gone)).toBe(0);
  });

  // The second half of the predicate. A tombstone on a tenant that still exists is a
  // mis-stamp, and destroying a live tenant's archive is the worst outcome here.
  it("never sweeps a tenant whose row is still there", async () => {
    await row(live, PartitionedTable.ACTIVITY_LOG, YEAR_AGO, DELETED_AT);

    const swept = await gateway.sweepDeleted(AFTER_THE_WINDOW);

    expect(swept.objects).toBe(0);
    expect(await remaining(live)).toBe(1);
  });

  it("ignores a deleted tenant's rows that carry no tombstone", async () => {
    await row(gone, PartitionedTable.ACTIVITY_LOG, YEAR_AGO, null);

    expect((await gateway.sweepDeleted(AFTER_THE_WINDOW)).objects).toBe(0);
    expect(await remaining(gone)).toBe(1);
  });
});

describe("PgPartitionArchiveGateway.markTenantDeleted", () => {
  it("stamps every row of the tenant and none of another's", async () => {
    await row(gone, PartitionedTable.ACTIVITY_LOG, YEAR_AGO, null);
    await row(gone, PartitionedTable.NOTIFICATIONS, YEAR_AGO, null);
    await row(live, PartitionedTable.ACTIVITY_LOG, YEAR_AGO, null);

    expect(await gateway.markTenantDeleted(gone, DELETED_AT)).toBe(2);

    const untouched = await database.client
      .select({ deletedAt: partitionArchive.deletedAt })
      .from(partitionArchive)
      .where(eq(partitionArchive.organizationId, live));
    expect(untouched[0]?.deletedAt).toBeNull();
  });

  // The window starts once. A second delete pass must not push it out, or a tenant
  // deleted twice keeps its objects for sixty days.
  it("does not move a tombstone that is already set", async () => {
    await row(gone, PartitionedTable.ACTIVITY_LOG, YEAR_AGO, DELETED_AT);

    expect(await gateway.markTenantDeleted(gone, AFTER_THE_WINDOW)).toBe(0);

    const found = await database.client
      .select({ deletedAt: partitionArchive.deletedAt })
      .from(partitionArchive)
      .where(
        and(
          eq(partitionArchive.organizationId, gone),
          sql`${partitionArchive.tableName} = ${PartitionedTable.ACTIVITY_LOG}`,
        ),
      );
    expect(found[0]?.deletedAt?.toISOString()).toBe(DELETED_AT.toISOString());
  });
});
