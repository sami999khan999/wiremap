import { createHash } from "node:crypto";
import type { Readable } from "node:stream";
import { PartitionArchiveGateway, PartitionedTable } from "@loadbearing/application";
import { Identifiers, type OrganizationId } from "@loadbearing/contracts";
import { Uuid } from "@loadbearing/core";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { StorageGateway, StoredObject } from "../../src/import.js";
import type { Database } from "../../src/pg/primitive/index.js";
import { DatabaseCluster } from "../../src/pg/primitive/index.js";
import { PgActivityLogger } from "../../src/pg/repository/pg-activity.logger.js";
import { PgMaintenanceGateway } from "../../src/pg/repository/pg-maintenance.gateway.js";
import { PgOutboxPublisher } from "../../src/pg/repository/pg-outbox.publisher.js";
import { PgPartitionArchiveGateway } from "../../src/pg/repository/pg-partition-archive.gateway.js";
import { notifications, organizations, partitionArchive } from "../../src/pg/schema/index.js";
import { TenantPartitionSeed } from "../../src/pg/seed/index.js";
import { PgUnitOfWork, ShardScope, TransactionScope } from "../../src/pg/transaction/index.js";
import { dropTenant, openDatabase, seedTenant } from "../support/database.js";

// One node, so nothing is ever placed: every repository here resolves to it.
const shards = new ShardScope();

// Its own month, so the partition this spec detaches and drops is never one another
// spec is reading. Two tenants, because one cannot tell a loop from a single call.
const PERIOD = new Date("2032-05-01T00:00:00.000Z");
const ISO = "2032-05-01";
const TABLE = PartitionedTable.ACTIVITY_LOG;

let database: Database;
let scope: TransactionScope;
let first: OrganizationId;
let second: OrganizationId;

// Keeps the bytes, so a restore reads back what an archive wrote. Failing on demand is
// the other half: both failures worth pinning happen after the detach.
class FakeStorage implements Partial<StorageGateway> {
  public failOnPut = false;
  public present = true;
  // Bytes S3 reports back, when that is not what was sent. A lost multipart part is the
  // shape: the object is there, answers its `HEAD`, and is short.
  public truncateTo: number | null = null;
  public body: Readable | undefined;
  public readonly objects = new Map<string, Uint8Array>();

  public async putStream(key: string, body: AsyncIterable<Uint8Array>): Promise<StoredObject> {
    this.body = body as Readable;
    if (this.failOnPut) throw new Error("s3 is down");

    const chunks: Uint8Array[] = [];
    let size = 0;
    for await (const chunk of body) {
      chunks.push(chunk);
      size += chunk.byteLength;
    }

    const joined = new Uint8Array(size);
    let at = 0;
    for (const chunk of chunks) {
      joined.set(chunk, at);
      at += chunk.byteLength;
    }

    this.objects.set(key, joined);
    // The real digest: a restore verifies the object against it now (`CR.16`).
    const checksum = createHash("sha256").update(joined).digest("hex");
    return { key, checksum, size, contentType: "application/x-ndjson+gzip" };
  }

  public get(key: string): Promise<Uint8Array> {
    const body = this.objects.get(key);
    if (!body) return Promise.reject(new Error(`no object: ${key}`));
    return Promise.resolve(body);
  }

  public async *getStream(key: string): AsyncGenerator<Uint8Array> {
    yield await this.get(key);
  }

  public delete(key: string): Promise<void> {
    this.objects.delete(key);
    return Promise.resolve();
  }

  public exists(key: string): Promise<boolean> {
    return Promise.resolve(this.present && this.objects.has(key));
  }

  public sizeOf(key: string): Promise<number | null> {
    if (!this.present || !this.objects.has(key)) return Promise.resolve(null);
    return Promise.resolve(this.truncateTo ?? this.objects.get(key)?.byteLength ?? null);
  }
}

const gateway = (storage: FakeStorage) =>
  new PgPartitionArchiveGateway(
    DatabaseCluster.single(database),
    scope,
    shards,
    storage as unknown as StorageGateway,
  );

const monthPartition = (organizationId: OrganizationId) =>
  `${TenantPartitionSeed.partitionName(TABLE, organizationId)}_2032_05`;

const exists = async (name: string) => {
  const result = await database.client.execute<{ present: boolean }>(
    sql`select to_regclass(${name}) is not null as present`,
  );
  return result.rows[0]?.present === true;
};

const isAttached = async (organizationId: OrganizationId) => {
  const result = await database.client.execute<{ attached: boolean }>(
    sql`select exists (
      select 1 from pg_inherits
      where inhrelid = to_regclass(${monthPartition(organizationId)})
        and inhparent = to_regclass(${TenantPartitionSeed.partitionName(TABLE, organizationId)})
    ) as attached`,
  );
  return result.rows[0]?.attached === true;
};

const write = async (organizationId: OrganizationId, action: string, count: number) => {
  const logger = new PgActivityLogger(DatabaseCluster.single(database), scope, shards, {
    now: () => PERIOD,
  });
  const actor = { userId: Uuid.v7(), organizationId, kind: "user" as const };
  for (let i = 0; i < count; i += 1) await logger.record(actor as never, action, { at: i });
};

const freshPartitions = async () => {
  const maintenance = new PgMaintenanceGateway(
    DatabaseCluster.single(database),
    scope,
    shards,
    new PgUnitOfWork(DatabaseCluster.single(database), scope, shards, "catalog"),
  );
  for (const organizationId of [first, second]) {
    await database.client.execute(
      sql`drop table if exists ${sql.identifier(monthPartition(organizationId))}`,
    );
    await maintenance.ensureMonthlyPartitions(TABLE, organizationId, PERIOD, 1);
  }
};

const founded = async (name: string): Promise<OrganizationId> => {
  const id = Identifiers.organizationId.parse(Uuid.v7());
  await database.client.insert(organizations).values({ id, slug: `cold-${id}`, name });
  await seedTenant(database, id);
  return id;
};

beforeAll(async () => {
  database = openDatabase();
  scope = new TransactionScope();
  first = await founded("Cold one");
  second = await founded("Cold two");
});

afterEach(async () => {
  await database.client.delete(partitionArchive).where(eq(partitionArchive.period, ISO));
  for (const organizationId of [first, second]) {
    const partition = monthPartition(organizationId);
    await database.client.execute(sql`drop table if exists ${sql.identifier(partition)}`);
    await database.client.execute(
      sql`drop table if exists ${sql.identifier(`${partition}_restore`)}`,
    );
  }
});

afterAll(async () => {
  for (const organizationId of [first, second]) await dropTenant(database, organizationId);
  await database.client
    .delete(organizations)
    .where(sql`${organizations.id} in (${first}::uuid, ${second}::uuid)`);
  await database.close();
});

describe("PgPartitionArchiveGateway.archive", () => {
  it("cuts one object per tenant under the cold prefix and drops every child", async () => {
    await freshPartitions();
    await write(first, "task.reactivated", 3);
    await write(second, "task.reactivated", 2);

    const storage = new FakeStorage();
    const result = await gateway(storage).archive(TABLE, PERIOD);

    expect(result.period).toBe(ISO);
    expect(result.objects).toHaveLength(2);
    // One rule on `cold/` tiers every table, which is the whole reason the layout is
    // fixed — and the tenant is the leaf, so one tenant's month is one object.
    expect(result.objects.map((object) => object.key).sort()).toEqual([
      `cold/activity_log/2032/05/${first}.ndjson.gz`,
      `cold/activity_log/2032/05/${second}.ndjson.gz`,
    ]);

    // The detach is per child, so a month that is dropped is a month that was archived.
    expect([...result.dropped].sort()).toEqual(
      [monthPartition(first), monthPartition(second)].sort(),
    );
    expect(await exists(monthPartition(first))).toBe(false);
    expect(await exists(monthPartition(second))).toBe(false);
  });

  it("records bytes, the row count and the per-action breakdown", async () => {
    await freshPartitions();
    await write(first, "task.reactivated", 3);
    await write(first, "task.archived", 1);

    const storage = new FakeStorage();
    await gateway(storage).archive(TABLE, PERIOD);

    const [recorded] = await database.client
      .select()
      .from(partitionArchive)
      .where(
        and(
          eq(partitionArchive.organizationId, first),
          eq(partitionArchive.tableName, TABLE),
          eq(partitionArchive.period, ISO),
        ),
      );

    expect(recorded?.rowCount).toBe(4);
    // Nothing else in this repository records what an object costs, which is why the
    // storage view had nowhere to read from before this column.
    expect(recorded?.bytes).toBeGreaterThan(0);
    expect(recorded?.actionCounts).toEqual({ "task.reactivated": 3, "task.archived": 1 });
    // Null means the derived store never received this tenant-month, and the prune is
    // the only thing that clears it.
    expect(recorded?.projectedAt).toBeNull();
  });

  // An absent row means "nothing to restore", never "not archived", which only holds if
  // an empty month writes neither an object nor a row.
  it("drops an empty tenant-month without writing an object or a row", async () => {
    await freshPartitions();
    await write(first, "task.reactivated", 1);

    const storage = new FakeStorage();
    const result = await gateway(storage).archive(TABLE, PERIOD);

    expect(result.objects).toHaveLength(1);
    expect(result.dropped).toHaveLength(2);
    expect(storage.objects.has(`cold/activity_log/2032/05/${second}.ndjson.gz`)).toBe(false);

    const rows = await database.client
      .select()
      .from(partitionArchive)
      .where(eq(partitionArchive.period, ISO));

    expect(rows).toHaveLength(1);
  });

  // The regression guard for a failure between detach and drop. The partition was left
  // detached — invisible to every query against the parent, and nothing put it back.
  it("re-attaches the partition when the upload fails", async () => {
    await freshPartitions();
    await write(first, "task.reactivated", 2);

    const storage = new FakeStorage();
    storage.failOnPut = true;

    await expect(gateway(storage).archive(TABLE, PERIOD)).rejects.toThrow("s3 is down");

    expect(await exists(monthPartition(first))).toBe(true);
    expect(await isAttached(first)).toBe(true);

    // The regression guard within the guard: the stream was left pulling pages out of a
    // partition nobody was uploading, until `afterEach` dropped it under the query.
    expect(storage.body?.destroyed).toBe(true);
  });

  it("re-attaches when the uploaded object cannot be verified", async () => {
    await freshPartitions();
    await write(first, "task.reactivated", 2);

    const storage = new FakeStorage();
    storage.present = false;

    await expect(gateway(storage).archive(TABLE, PERIOD)).rejects.toThrow("missing bytes");

    expect(await isAttached(first)).toBe(true);
  });

  // `R.39`. The object is there and answers its `HEAD`, which is all the check used to
  // ask — so a partition was dropped behind an archive that had lost a part.
  it("re-attaches when the stored object is shorter than what was sent", async () => {
    await freshPartitions();
    await write(first, "task.reactivated", 2);

    const storage = new FakeStorage();
    storage.truncateTo = 3;

    await expect(gateway(storage).archive(TABLE, PERIOD)).rejects.toThrow("3 bytes, expected");

    expect(await isAttached(first)).toBe(true);
  });
});

describe("PgPartitionArchiveGateway.sweep", () => {
  // Deleting a tenant cascades cleanly through Postgres and leaves every object behind.
  // That hole is created by cold storage, so cold storage closes it.
  it("deletes one tenant's objects and rows and nobody else's", async () => {
    await freshPartitions();
    await write(first, "task.reactivated", 2);
    await write(second, "task.reactivated", 2);

    const storage = new FakeStorage();
    await gateway(storage).archive(TABLE, PERIOD);

    expect(await gateway(storage).sweep(first)).toBe(1);

    expect(storage.objects.has(`cold/activity_log/2032/05/${first}.ndjson.gz`)).toBe(false);
    expect(storage.objects.has(`cold/activity_log/2032/05/${second}.ndjson.gz`)).toBe(true);

    const rows = await database.client
      .select()
      .from(partitionArchive)
      .where(eq(partitionArchive.period, ISO));

    expect(rows.map((row) => row.organizationId)).toEqual([second]);
  });
});

// The whole point of the rename: one gateway, every partitioned table. These two take
// the paths `activity_log` never exercises — a different time column, and no tenant level.
describe("PgPartitionArchiveGateway across the allowlist", () => {
  const notificationMonth = (organizationId: OrganizationId) =>
    `${TenantPartitionSeed.partitionName(PartitionedTable.NOTIFICATIONS, organizationId)}_2032_05`;

  const outboxMonth = `${PartitionedTable.OUTBOX_EVENT}_2032_05`;

  afterEach(async () => {
    for (const name of [notificationMonth(first), outboxMonth]) {
      await database.client.execute(sql`drop table if exists ${sql.identifier(name)}`);
    }
  });

  // `created_at`, not `occurred_at`. The keyset comes off the allowlist entry, which is
  // what lets one loop serve a table this gateway was never written against.
  it("archives a table ranged by a different column", async () => {
    const maintenance = new PgMaintenanceGateway(
      DatabaseCluster.single(database),
      scope,
      shards,
      new PgUnitOfWork(DatabaseCluster.single(database), scope, shards, "catalog"),
    );
    await database.client.execute(
      sql`drop table if exists ${sql.identifier(notificationMonth(first))}`,
    );
    await maintenance.ensureMonthlyPartitions(PartitionedTable.NOTIFICATIONS, first, PERIOD, 1);

    // Any id: `notifications.user_id` has no foreign key, so the spec needs no signed-up
    // user and runs on a fresh database.
    await database.client.insert(notifications).values({
      id: Uuid.v7(),
      organizationId: first,
      userId: Uuid.v7() as never,
      eventId: Uuid.v7(),
      kind: "task.assigned",
      category: "task",
      createdAt: PERIOD,
    });

    const storage = new FakeStorage();
    const result = await gateway(storage).archive(PartitionedTable.NOTIFICATIONS, PERIOD);

    expect(result.objects).toHaveLength(1);
    expect(result.objects[0]?.key).toBe(`cold/notifications/2032/05/${first}.ndjson.gz`);
    // No `action` column, so the breakdown stays empty rather than guessing at one.
    expect(result.objects[0]?.actionCounts).toEqual({});
    expect(await exists(notificationMonth(first))).toBe(false);
  });

  // The one table with no tenant level, because the drain polls it every second. Its
  // month is one object under the nil uuid, which names no row on purpose.
  it("archives the table with no tenant level under the nil uuid", async () => {
    const maintenance = new PgMaintenanceGateway(
      DatabaseCluster.single(database),
      scope,
      shards,
      new PgUnitOfWork(DatabaseCluster.single(database), scope, shards, "catalog"),
    );
    await database.client.execute(sql`drop table if exists ${sql.identifier(outboxMonth)}`);
    await maintenance.ensureMonthlyPartitions(PartitionedTable.OUTBOX_EVENT, null, PERIOD, 1);

    await new PgOutboxPublisher(DatabaseCluster.single(database), scope, shards, {
      now: () => PERIOD,
    }).publish(
      { organizationId: first, userId: Uuid.v7(), kind: "user" } as never,
      { name: "task.created", payload: { taskId: Uuid.v7() } } as never,
    );

    const storage = new FakeStorage();
    const result = await gateway(storage).archive(PartitionedTable.OUTBOX_EVENT, PERIOD);

    expect(result.objects).toHaveLength(1);
    expect(result.objects[0]?.organizationId).toBe(PartitionArchiveGateway.NO_TENANT);
    expect(result.objects[0]?.key).toBe(
      `cold/outbox_event/2032/05/${PartitionArchiveGateway.NO_TENANT}.ndjson.gz`,
    );
    expect(await exists(outboxMonth)).toBe(false);
  });
});

describe("PartitionArchiveGateway", () => {
  // The nil uuid names no row, which is what makes an object under it readable as "this
  // one spans every tenant" rather than as somebody's.
  it("reserves the nil uuid for a table with no tenant level", () => {
    expect(PartitionArchiveGateway.NO_TENANT).toBe("00000000-0000-0000-0000-000000000000");
  });
});
