import { PartitionedTable } from "@loadbearing/application";
import { Identifiers, type OrganizationId, type UserId } from "@loadbearing/contracts";
import { Uuid } from "@loadbearing/core";
import { and, eq, inArray, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "../../src/pg/primitive/index.js";
import { DatabaseCluster } from "../../src/pg/primitive/index.js";
import { PgMaintenanceGateway } from "../../src/pg/repository/pg-maintenance.gateway.js";
import { invitations, roles, sessions, users, verifications } from "../../src/pg/schema/index.js";
import { TenantPartitionSeed } from "../../src/pg/seed/index.js";
import { PgUnitOfWork, ShardScope, TransactionScope } from "../../src/pg/transaction/index.js";
import { openDatabase, seedOrganizationId } from "../support/database.js";

// One node, so nothing is ever placed: every repository here resolves to it.
const shards = new ShardScope();

let database: Database;
let gateway: PgMaintenanceGateway;
let organizationId: OrganizationId;
let sweeper: UserId;
let roleId: string;

const identifiers: string[] = [];
const invited: string[] = [];

// Deliberately in the past, for the reason `sweepExpired` gives below: the drop cases
// take a cutoff and no table filter, so a month after today takes the real partitions.
const FROM = new Date("2020-07-01T00:00:00.000Z");

// A month is `<table>_<32hex>_<yyyy>_<mm>` since `0023`: it hangs off the tenant's list
// partition, not off the table. Derived once the seeded tenant is known.
let tenantPartition: string;
let NAMES: string[] = [];

beforeAll(async () => {
  database = openDatabase();
  const scope = new TransactionScope();
  gateway = new PgMaintenanceGateway(
    DatabaseCluster.single(database),
    scope,
    shards,
    new PgUnitOfWork(DatabaseCluster.single(database), scope, shards, "catalog"),
  );

  organizationId = await seedOrganizationId(database);
  tenantPartition = TenantPartitionSeed.partitionName(
    PartitionedTable.ACTIVITY_LOG,
    organizationId,
  );
  NAMES = [`${tenantPartition}_2020_07`, `${tenantPartition}_2020_08`];

  sweeper = Identifiers.userId.parse(Uuid.v7());
  await database.client
    .insert(users)
    .values({ id: sweeper, name: "Sweeper", email: `${sweeper}@example.test` });

  // The seeded `member` role, because an invitation needs one and this spec is not about
  // which role it names.
  const [role] = await database.client
    .select({ id: roles.id })
    .from(roles)
    .where(and(eq(roles.organizationId, organizationId), eq(roles.key, "member")))
    .limit(1);
  if (!role) throw new Error("run `pnpm db:seed` first");
  roleId = role.id;
});

afterAll(async () => {
  for (const name of NAMES) {
    await database.client.execute(sql.raw(`drop table if exists ${name}`));
  }

  // The live rows the sweep was supposed to leave behind. Sessions cascade off the user.
  await database.client.delete(verifications).where(inArray(verifications.identifier, identifiers));
  if (invited.length > 0) {
    await database.client.delete(invitations).where(inArray(invitations.email, invited));
  }
  await database.client.delete(users).where(inArray(users.id, [sweeper]));
  await database.close();
});

describe("PgMaintenanceGateway.ensureMonthlyPartitions", () => {
  // The regression guard for the parameterised form, which failed at bind time on every
  // run: Postgres accepts no bind parameters in DDL, and no fake can reach that.
  it("actually creates the partitions it reports", async () => {
    const created = await gateway.ensureMonthlyPartitions(
      PartitionedTable.ACTIVITY_LOG,
      organizationId,
      FROM,
      2,
    );
    expect(created).toEqual(NAMES);

    const rows = await database.client.execute<{ relname: string }>(
      sql`select c.relname
          from pg_class c
          join pg_inherits i on i.inhrelid = c.oid
          join pg_class p on p.oid = i.inhparent
          where p.relname = ${tenantPartition} and c.relname like ${`${tenantPartition}_2020_%`}
          order by c.relname`,
    );

    // Attached, not merely existing: a table created without `PARTITION OF` satisfies
    // `to_regclass` on the next run and is never written to.
    expect(rows.rows.map((row) => row.relname)).toEqual(NAMES);
  });

  it("is idempotent, so a second run creates nothing", async () => {
    // The schedule registers on every boot and runs monthly; a second call has to be
    // a no-op rather than an error, or a redeploy turns into a failed job.
    expect(
      await gateway.ensureMonthlyPartitions(PartitionedTable.ACTIVITY_LOG, organizationId, FROM, 2),
    ).toEqual([]);
  });

  // Two replicas booting together: probe-and-create is two statements, and when both
  // probe before either creates the loser gets 42P07 — reproduced by hand.

  // Held from another connection rather than raced for: a race through the public API
  // cannot be made to interleave, and a lucky pass is worse than no spec at all.
  it("takes an advisory lock the whole ensure runs under", async () => {
    const lock = PgMaintenanceGateway.lockFor(PartitionedTable.ACTIVITY_LOG);
    await database.client.execute(sql.raw(`drop table if exists ${NAMES.join(", ")}`));

    // Started inside the holder's transaction, awaited outside it: awaiting inside is a
    // self-deadlock that `lock_timeout` ends with 55P03 rather than an answer.
    let ensure: Promise<"finished"> | undefined;

    await database.client.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(${lock.namespace}, ${lock.key})`);

      ensure = gateway
        .ensureMonthlyPartitions(PartitionedTable.ACTIVITY_LOG, organizationId, FROM, 2)
        .then(() => "finished" as const);
      const blocked = new Promise<"blocked">((resolve) =>
        setTimeout(() => resolve("blocked"), 600),
      );

      expect(await Promise.race([ensure, blocked])).toBe("blocked");
    });

    // And it completes once the holder commits, which is what says it was waiting on the
    // lock rather than simply failing.
    expect(await ensure).toBe("finished");
    expect(
      await gateway.monthlyPartitionsAfter(PartitionedTable.ACTIVITY_LOG, organizationId, FROM),
    ).toBeGreaterThan(0);
  });
});

describe("PgMaintenanceGateway.monthlyPartitionsAfter", () => {
  // Relative, not absolute: this database also holds the real months the migrations made,
  // and every one of them is "after" a scratch window sitting in 2020.
  it("counts the months ahead and excludes the current one", async () => {
    await gateway.ensureMonthlyPartitions(PartitionedTable.ACTIVITY_LOG, organizationId, FROM, 2);

    const fromJuly = await gateway.monthlyPartitionsAfter(
      PartitionedTable.ACTIVITY_LOG,
      organizationId,
      FROM,
    );
    const fromAugust = await gateway.monthlyPartitionsAfter(
      PartitionedTable.ACTIVITY_LOG,
      organizationId,
      new Date("2020-08-01T00:00:00.000Z"),
    );

    // Exactly one partition lies between the two readings — August's — which is the
    // "strictly after" boundary this method exists to get right.
    expect(fromJuly - fromAugust).toBe(1);
  });
});

describe("PgMaintenanceGateway.dropMonthlyPartitionsBefore", () => {
  // The cutoff is read as a month boundary, not an instant: a partition holding the
  // cutoff's own month also holds rows newer than it, and dropping it would lose them.
  it("drops only the partitions whose month ends before the cutoff month", async () => {
    await gateway.ensureMonthlyPartitions(PartitionedTable.ACTIVITY_LOG, organizationId, FROM, 2);

    const dropped = await gateway.dropMonthlyPartitionsBefore(
      PartitionedTable.ACTIVITY_LOG,
      organizationId,
      new Date("2020-08-15T00:00:00.000Z"),
    );

    expect(dropped).toContain(NAMES[0]);
    expect(dropped).not.toContain(NAMES[1]);

    // The regression, and the reason the months above are in the past: a cutoff later
    // than today sweeps every partition the migrations made, under every other spec.
    expect(dropped.filter((name) => !NAMES.includes(name))).toEqual([]);
  });

  // The loop holds a `drop table`, so a child it cannot parse has to be left alone: an
  // unrecognised name is not evidence that the rows in it are expendable.
  it("leaves a child whose name is not <table>_<yyyy>_<mm> alone", async () => {
    const scratch = `${tenantPartition}_scratch`;
    await database.client.execute(
      sql.raw(`create table if not exists ${scratch} partition of ${tenantPartition}
          for values from ('2021-01-01') to ('2021-02-01')`),
    );

    try {
      const dropped = await gateway.dropMonthlyPartitionsBefore(
        PartitionedTable.ACTIVITY_LOG,
        organizationId,
        new Date("2021-06-01T00:00:00.000Z"),
      );

      expect(dropped).not.toContain(scratch);
    } finally {
      await database.client.execute(sql.raw(`drop table if exists ${scratch}`));
    }
  });
});

// The gateway's own rows, so a run leaves the scratch database as it found it.
const session = (expiresAt: Date) => ({
  id: Uuid.v7(),
  token: Uuid.v7(),
  userId: sweeper,
  activeOrganizationId: organizationId,
  surface: "web" as const,
  expiresAt,
});

const verification = (expiresAt: Date) => {
  const identifier = `sweep-${Uuid.v7()}`;
  identifiers.push(identifier);
  return { id: Uuid.v7(), identifier, value: "v", expiresAt };
};

const invitation = (expiresAt: Date) => {
  const email = `sweep-${Uuid.v7()}@example.test`;
  invited.push(email);
  return {
    id: Uuid.v7(),
    organizationId,
    email,
    roleId,
    tokenHash: Uuid.v7(),
    invitedBy: sweeper,
    expiresAt,
  };
};

describe("PgMaintenanceGateway.sweepExpired", () => {
  // Deliberately in the past, not the future: `sweepExpired` takes a clock and no tenant,
  // so sweeping at 2030 deletes the rows every other spec is holding.
  const now = new Date("2020-01-01T00:00:00.000Z");
  const expired = new Date("2019-12-31T23:59:59.000Z");
  const live = new Date("2020-01-01T00:00:01.000Z");

  it("counts the rows it deleted, not the rows it read back", async () => {
    // Cleared first: the count is exact only against a table holding no expired row this
    // spec did not write, and the scratch database is shared with every other spec here.
    await gateway.sweepExpired(now);

    await database.client.insert(sessions).values([session(expired), session(expired)]);
    await database.client.insert(sessions).values(session(live));
    await database.client.insert(verifications).values(verification(expired));
    await database.client.insert(verifications).values([verification(live), verification(live)]);
    await database.client.insert(invitations).values([invitation(expired), invitation(live)]);

    // The regression: this used `.returning({ id })` and counted the array, shipping every
    // expired row back over the wire to be measured and thrown away.
    expect(await gateway.sweepExpired(now)).toEqual({
      sessions: 2,
      verifications: 1,
      invitations: 1,
    });
  });

  // Not housekeeping. `invitations_email_uq` is on `(organization_id, email)`, so a lapsed
  // row keeps that address un-invitable until something removes it.
  it("frees the address a lapsed invitation was holding", async () => {
    const lapsed = invitation(expired);
    await database.client.insert(invitations).values(lapsed);

    await gateway.sweepExpired(now);

    const remaining = await database.client
      .select({ id: invitations.id })
      .from(invitations)
      .where(eq(invitations.email, lapsed.email));

    expect(remaining).toHaveLength(0);
  });

  it("leaves the unexpired rows alone, and reports zero on a second pass", async () => {
    expect(await gateway.sweepExpired(now)).toEqual({
      sessions: 0,
      verifications: 0,
      invitations: 0,
    });

    const remaining = await database.client
      .select({ id: sessions.id })
      .from(sessions)
      .where(inArray(sessions.userId, [sweeper]));

    expect(remaining).toHaveLength(1);
  });
});
