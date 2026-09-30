import { PartitionedTable } from "@loadbearing/application";
import { Uuid } from "@loadbearing/core";
import type { Logger } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { OrganizationId } from "../../src/import.js";
import type { Database } from "../../src/pg/primitive/index.js";
import { DatabaseCluster } from "../../src/pg/primitive/index.js";
import { PgActivityLogger } from "../../src/pg/repository/pg-activity.logger.js";
import { PgActivityReplayReader } from "../../src/pg/repository/pg-activity-replay.reader.js";
import { PgMaintenanceGateway } from "../../src/pg/repository/pg-maintenance.gateway.js";
import { TenantPartitionSeed } from "../../src/pg/seed/index.js";
import { PgUnitOfWork, ShardScope, TransactionScope } from "../../src/pg/transaction/index.js";
import { DATABASE_URL, openDatabase, seedOrganizationId } from "../support/database.js";

// One node, so nothing is ever placed: every repository here resolves to it.
const shards = new ShardScope();

// Captures the statement the reader issued, so the EXPLAIN below runs the query under
// test rather than a copy of it.
class RecordingLogger implements Logger {
  public last: { query: string; params: unknown[] } | null = null;

  public logQuery(query: string, params: unknown[]): void {
    this.last = { query, params };
  }
}

const recorder = new RecordingLogger();
let database: Database;
let reader: PgActivityReplayReader;
let logger: PgActivityLogger;
let partition: string;
let organization: OrganizationId;

// Every row shares one instant, which is the point: a keyset carrying only a timestamp
// cannot separate them, and the bug that hides is invisible against spread-out data.
const INSTANT = new Date("2031-03-01T00:00:00.000Z");

// Past every row this spec writes. The settle horizon is the consumer's policy — these
// cases are about the keyset, and a horizon here would hide it behind an empty page.
const NO_HORIZON = new Date("2099-01-01T00:00:00.000Z");

// Where every read starts, because `since()` walks the whole table by design. Both
// halves: a checkpoint carrying only a timestamp is treated as none at all.
const BEFORE = {
  lastOccurredAt: new Date(INSTANT.getTime() - 1),
  lastId: "00000000-0000-0000-0000-000000000000",
};

beforeAll(async () => {
  database = openDatabase(recorder);
  const scope = new TransactionScope();
  reader = new PgActivityReplayReader(DatabaseCluster.single(database), scope, shards);
  logger = new PgActivityLogger(DatabaseCluster.single(database), scope, shards, {
    now: () => INSTANT,
  });

  // A partitioned table with no partition for a row's date rejects the insert, so a spec
  // that writes to a future month creates it first — under the tenant it writes as.
  organization = await seedOrganizationId(database);
  await new PgMaintenanceGateway(
    DatabaseCluster.single(database),
    scope,
    shards,
    new PgUnitOfWork(DatabaseCluster.single(database), scope, shards, "catalog"),
  ).ensureMonthlyPartitions(PartitionedTable.ACTIVITY_LOG, organization, INSTANT, 1);

  partition = `${TenantPartitionSeed.partitionName(
    PartitionedTable.ACTIVITY_LOG,
    organization,
  )}_2031_03`;
});

afterAll(async () => {
  // Drop the partition rather than delete rows: the table is shared with another spec, so
  // a predicate delete risks taking rows it asserts on.
  await database.client.execute(sql.raw(`drop table if exists ${partition}`));
  await database.close();
});

const write = async (count: number) => {
  const organizationId = await seedOrganizationId(database);
  const actor = { userId: Uuid.v7(), organizationId, kind: "user" as const };

  for (let i = 0; i < count; i++) {
    await logger.record(actor as never, "task.reactivated", { taskId: Uuid.v7() });
  }

  return organizationId;
};

// Only this spec's rows: nothing else writes to 2031-03, and the partition is dropped
// afterwards, so reading from `BEFORE` is exactly this window.
const mine = async () =>
  (await reader.since(organization, BEFORE, 1_000, [], NO_HORIZON)).filter(
    (record) => record.occurredAt.getTime() === INSTANT.getTime(),
  );

describe("PgActivityReplayReader", () => {
  it("walks rows sharing a timestamp without dropping or repeating one", async () => {
    await write(5);

    const all = await mine();
    expect(all).toHaveLength(5);

    // The projection's loop. From `BEFORE` rather than the table start: a walk from null
    // is bounded by how many rows the seed happens to have written.
    const seen: string[] = [];
    let checkpoint: { lastOccurredAt: Date | null; lastId: string | null } = { ...BEFORE };

    for (let i = 0; i < 10; i++) {
      const batch = await reader.since(organization, checkpoint, 2, [], NO_HORIZON);
      const window = batch.filter((r) => r.occurredAt.getTime() === INSTANT.getTime());
      seen.push(...window.map((r) => r.id));
      if (batch.length === 0) break;

      const last = batch[batch.length - 1];
      if (!last) break;
      checkpoint = { lastOccurredAt: last.occurredAt, lastId: last.id };
    }

    expect(seen).toEqual(all.map((record) => record.id));
    expect(new Set(seen).size).toBe(seen.length);
  });

  it("resumes strictly after the checkpoint", async () => {
    const all = await mine();
    const third = all[2];
    if (!third) throw new Error("expected the previous test to have written five rows");

    const rest = (
      await reader.since(
        organization,
        { lastOccurredAt: third.occurredAt, lastId: third.id },
        1_000,
        [],
        NO_HORIZON,
      )
    ).filter((record) => record.occurredAt.getTime() === INSTANT.getTime());

    // Strictly after: the checkpoint row itself must not come back, or every run
    // reprojects it and the reconciliation reports drift the projection caused.
    expect(rest.map((record) => record.id)).toEqual(all.slice(3).map((record) => record.id));
  });

  it("lifts a subject out of the payload and brands the ids", async () => {
    const organizationId = await seedOrganizationId(database);
    const taskId = Uuid.v7();
    const actor = { userId: Uuid.v7(), organizationId, kind: "user" as const };

    await logger.record(actor as never, "task.completed", { taskId });

    const record = (await mine()).find((r) => r.action === "task.completed");
    expect(record?.subjectId).toBe(taskId);
    expect(record?.organizationId).toBe(organizationId);
  });

  it("counts by day in the shape the reconciliation diffs", async () => {
    const to = new Date(INSTANT.getTime() + 24 * 60 * 60 * 1_000);
    const counts = await reader.dailyCounts(organization, INSTANT, to);
    const day = counts.find((count) => count.day === "2031-03-01");

    // Six: five from the first test, one from the third.
    expect(day?.rows).toBe(6);
    // A number, not a string: `count(*)` comes back as text from `pg`, and a string here
    // makes the reconciliation diff every day forever.
    expect(typeof day?.rows).toBe("number");
  });

  // Per tenant since `16.6`, which is what makes the tenant level pay: the predicate
  // prunes to one list partition, and the walk runs on an index inside it.
  it("prunes to one tenant's partition and walks it on an index", async () => {
    await reader.since(organization, BEFORE, 2, [], NO_HORIZON);

    const issued = recorder.last;
    if (!issued) throw new Error("expected the walk above to have been logged");

    const pool = new Pool({ connectionString: DATABASE_URL });
    const client = await pool.connect();

    try {
      await client.query("begin");
      await client.query("set local enable_seqscan = off");
      const explained = await client.query(`explain ${issued.query}`, issued.params);
      await client.query("rollback");

      const plan = explained.rows.map((row) => Object.values(row).join(" ")).join(" | ");

      // The tenant's subtree and nothing outside it. Before `16.6` this walk had no
      // tenant predicate, so every batch appended every tenant's months.
      expect(plan).toContain(partition);
      expect(plan).not.toMatch(/Seq Scan/);
      // `activity_log_replay_idx` propagates to every month child under a generated
      // name, so the assertion is on the shape rather than on the name.
      expect(plan).toMatch(/Index (Only )?Scan|Bitmap Index Scan/);
    } finally {
      client.release();
      await pool.end();
    }
  });

  // `CR.29`. The `OR` keyset fell out of the index into a row-by-row filter, so every page
  // after the first re-read the checkpoint's month from its start.
  it("keeps a checkpoint inside the index condition", async () => {
    const checkpoint = {
      lastOccurredAt: INSTANT,
      lastId: "018f8c00-0000-7000-8000-000000000001",
    } as unknown as typeof BEFORE;
    await reader.since(organization, checkpoint, 2, [], NO_HORIZON);

    const issued = recorder.last;
    if (!issued) throw new Error("expected the walk above to have been logged");

    const pool = new Pool({ connectionString: DATABASE_URL });
    const client = await pool.connect();

    try {
      await client.query("begin");
      await client.query("set local enable_seqscan = off");
      const explained = await client.query(`explain ${issued.query}`, issued.params);
      await client.query("rollback");

      const plan = explained.rows.map((row) => Object.values(row).join(" ")).join(" | ");
      expect(plan).toMatch(/Index Cond: .*ROW\(occurred_at, id\) >/);
    } finally {
      client.release();
      await pool.end();
    }
  });

  it("returns nothing for a window with no rows", async () => {
    const from = new Date("2031-04-01T00:00:00.000Z");
    const to = new Date("2031-04-02T00:00:00.000Z");
    expect(await reader.dailyCounts(organization, from, to)).toEqual([]);
  });
});
