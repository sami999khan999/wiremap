import { PartitionedTable } from "@loadbearing/application";
import {
  type DocSpaceId,
  Identifiers,
  type OrganizationId,
  type UserId,
} from "@loadbearing/contracts";
import { Uuid } from "@loadbearing/core";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "../../src/pg/primitive/index.js";
import { DatabaseCluster } from "../../src/pg/primitive/index.js";
import { PgMaintenanceGateway } from "../../src/pg/repository/pg-maintenance.gateway.js";
import {
  activityLog,
  docSpaces,
  notifications,
  organizations,
  users,
} from "../../src/pg/schema/index.js";
import { TenantPartitionSeed } from "../../src/pg/seed/index.js";
import { PgUnitOfWork, ShardScope, TransactionScope } from "../../src/pg/transaction/index.js";
import { openDatabase } from "../support/database.js";

// One node, so nothing is ever placed: every repository here resolves to it.
const shards = new ShardScope();

let database: Database;
let gateway: PgMaintenanceGateway;
let seed: TenantPartitionSeed;
let author: UserId;

const tenant = async (): Promise<OrganizationId> => {
  const organizationId = Identifiers.organizationId.parse(Uuid.v7());
  await database.client
    .insert(organizations)
    .values({ id: organizationId, slug: `drop-${organizationId}`, name: "Drop" });
  await seed.run(organizationId);
  return organizationId;
};

// Rows in two ranged tables and a tenant-only one, so the drop is proved on a tenant
// holding data: detaching a partition something points into is refused.
const populate = async (organizationId: OrganizationId): Promise<void> => {
  await database.client
    .insert(activityLog)
    .values({ id: Uuid.v7(), organizationId, actorId: author, action: "drop.tested" });
  await database.client.insert(notifications).values({
    id: Uuid.v7(),
    organizationId,
    userId: author,
    eventId: Uuid.v7(),
    kind: "member.joined",
    category: "membership",
  });
  await database.client.insert(docSpaces).values({
    id: Uuid.v7() as DocSpaceId,
    organizationId,
    slug: "drop",
    title: "Drop",
    createdBy: author,
  });
};

// Inlined rather than bound: drizzle sends a JS array as a record, and `= any($1)` then
// fails with "requires array on right side". Every value here is a constant in this file.
const quoted = (values: readonly string[]) =>
  sql.raw(values.map((value) => `'${value}'`).join(", "));

// Every key that points into a tenant-partitioned table. Any one of them makes each
// signup's attach lock its target, and makes the drop detach before it can drop.
const keysIntoPartitionedTables = async (): Promise<readonly string[]> => {
  const parents = PartitionedTable.TENANT_PARTITIONED.map((entry) => entry.name);
  const rows = await database.client.execute<{ conname: string }>(sql`
    select conname
    from pg_constraint
    where contype = 'f'
      and confrelid in (select oid from pg_class where relname in (${quoted(parents)}))
    order by conname
  `);

  return rows.rows.map((row) => row.conname);
};

const partitionsOf = async (organizationId: OrganizationId): Promise<readonly string[]> => {
  const names = PartitionedTable.TENANT_PARTITIONED.map((entry) =>
    TenantPartitionSeed.partitionName(entry.name, organizationId),
  );

  const rows = await database.client.execute<{ name: string }>(sql`
    select relname as name from pg_class where relname in (${quoted(names)}) order by relname
  `);

  return rows.rows.map((row) => row.name);
};

// One of the tenant's runway months under `notifications`, by name from the catalog.
const runwayMonthOf = async (organizationId: OrganizationId): Promise<string> => {
  const parent = TenantPartitionSeed.partitionName("notifications", organizationId);
  const rows = await database.client.execute<{ name: string }>(sql`
    select c.relname as name from pg_inherits i
    join pg_class c on c.oid = i.inhrelid
    join pg_class p on p.oid = i.inhparent
    where p.relname = ${parent}
    order by c.relname desc
    limit 1
  `);
  return rows.rows[0]?.name ?? "";
};

beforeAll(async () => {
  database = openDatabase();
  const scope = new TransactionScope();
  gateway = new PgMaintenanceGateway(
    DatabaseCluster.single(database),
    scope,
    shards,
    new PgUnitOfWork(DatabaseCluster.single(database), scope, shards, "catalog"),
  );
  seed = new TenantPartitionSeed(DatabaseCluster.single(database), scope, shards);

  author = Identifiers.userId.parse(Uuid.v7());
  await database.client
    .insert(users)
    .values({ id: author, name: "Dropper", email: `${author}@example.test` });
});

afterAll(async () => {
  await database.client.delete(users).where(eq(users.id, author));
  await database.close();
});

describe("TenantPartitionSeed", () => {
  it("creates every tenant partition, and a second run creates nothing", async () => {
    const organizationId = await tenant();

    try {
      expect(await partitionsOf(organizationId)).toHaveLength(
        PartitionedTable.TENANT_PARTITIONED.length,
      );
      // Idempotent, because three callers can run it twice: the founder, the seed script
      // and `migrate.ts` all reach it for an organization that may already have them.
      expect(await seed.run(organizationId)).toEqual([]);
    } finally {
      await gateway.dropTenantPartitions(organizationId);
      await database.client.delete(organizations).where(eq(organizations.id, organizationId));
    }
  });

  // `PF.4`: what `migrate.ts` asks per page, so a deploy seeds only who is short.
  it("names only the tenants that are short of a partition", async () => {
    const whole = await tenant();
    const short = await tenant();
    const none = Identifiers.organizationId.parse(Uuid.v7());
    // A runway month gone is short too: the next insert past month end would fail.
    const month = await runwayMonthOf(short);

    try {
      await database.client.execute(sql.raw(`drop table ${month}`));

      expect(await seed.missing([whole, short, none])).toEqual([short, none]);
      await seed.run(short);
      expect(await seed.missing([whole, short])).toEqual([]);
    } finally {
      for (const id of [whole, short]) {
        await gateway.dropTenantPartitions(id);
        await database.client.delete(organizations).where(eq(organizations.id, id));
      }
    }
  });
});

// The exit criterion Phase 16 states in so many words: a row for a tenant with no
// partition fails with the Postgres error, never silently.
describe("a tenant with no partitions", () => {
  it("refuses the write rather than losing it", async () => {
    const organizationId = Identifiers.organizationId.parse(Uuid.v7());
    await database.client
      .insert(organizations)
      .values({ id: organizationId, slug: `bare-${organizationId}`, name: "Bare" });

    try {
      const write = database.client
        .insert(activityLog)
        .values({ id: Uuid.v7(), organizationId, actorId: author, action: "bare.tested" });

      // The cause, not the message: drizzle wraps every failure as "Failed query", and
      // asserting on that would pass for a typo as readily as for the missing partition.
      const error = await write.then(
        () => null,
        (thrown: unknown) => thrown as { cause?: { message?: string; code?: string } },
      );

      expect(error?.cause?.code).toBe("23514");
      expect(error?.cause?.message).toMatch(/no partition of relation "activity_log" found/i);
    } finally {
      await database.client.delete(organizations).where(eq(organizations.id, organizationId));
    }
  });
});

describe("PgMaintenanceGateway.dropTenantPartitions", () => {
  it("takes the tenant's whole subtree, months included", async () => {
    const organizationId = await tenant();
    await populate(organizationId);

    const dropped = await gateway.dropTenantPartitions(organizationId);

    expect(dropped).toHaveLength(PartitionedTable.TENANT_PARTITIONED.length);
    expect(await partitionsOf(organizationId)).toEqual([]);

    // The month children went with their tenant partition rather than being left behind
    // as detached tables nothing references.
    const orphans = await database.client.execute<{ name: string }>(sql`
      select relname as name from pg_class
      where relname like ${`%_${organizationId.replaceAll("-", "")}_%`}
    `);
    expect(orphans.rows).toEqual([]);

    await database.client.delete(organizations).where(eq(organizations.id, organizationId));
  });

  // `PF.1` dropped the last of them. A new one brings back the attach lock —
  // docs/reference/partitions.md.
  it("has no foreign key into any tenant-partitioned table, before or after a drop", async () => {
    expect(await keysIntoPartitionedTables()).toEqual([]);

    const organizationId = await tenant();
    await populate(organizationId);
    await gateway.dropTenantPartitions(organizationId);
    await database.client.delete(organizations).where(eq(organizations.id, organizationId));

    expect(await keysIntoPartitionedTables()).toEqual([]);
  });

  // `PF.2`: one statement per table and no transaction around them. In one transaction,
  // a reader on one table held every other parent's ACCESS EXCLUSIVE until it let go.
  it("drops the other tables while a reader holds one of them", async () => {
    const organizationId = await tenant();
    const reader = openDatabase();
    // The allowlist's first table, which the reverse walk drops last.
    const held = PartitionedTable.TENANT_PARTITIONED[0]?.name ?? "";

    let release = (): void => {};
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    let opened = (): void => {};
    const open = new Promise<void>((resolve) => {
      opened = resolve;
    });

    const reading = reader.client.transaction(async (tx) => {
      await tx.execute(
        sql.raw(`select 1 from ${held} where organization_id = '${organizationId}' limit 1`),
      );
      opened();
      await released;
    });

    try {
      await open;
      const dropping = gateway.dropTenantPartitions(organizationId);

      // Committed and visible from outside while the drop still waits on `held`.
      await expect
        .poll(async () => (await partitionsOf(organizationId)).length, { timeout: 15_000 })
        .toBe(1);

      release();
      await reading;
      await dropping;
      expect(await partitionsOf(organizationId)).toEqual([]);
    } finally {
      release();
      await reading.catch(() => undefined);
      await reader.close();
      await database.client.delete(organizations).where(eq(organizations.id, organizationId));
    }
  });

  it("is a no-op for a tenant whose partitions are already gone", async () => {
    const organizationId = await tenant();
    await gateway.dropTenantPartitions(organizationId);

    expect(await gateway.dropTenantPartitions(organizationId)).toEqual([]);
    await database.client.delete(organizations).where(eq(organizations.id, organizationId));
  });
});
