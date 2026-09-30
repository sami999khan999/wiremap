import { PartitionedTable, Principal } from "@loadbearing/application";
import { Identifiers, type OrganizationId, type UserId } from "@loadbearing/contracts";
import { SystemClock, Uuid } from "@loadbearing/core";
import { CapabilitySet } from "@loadbearing/permissions";
import { sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "../../src/pg/primitive/index.js";
import { DatabaseCluster } from "../../src/pg/primitive/index.js";
import { PgMaintenanceGateway } from "../../src/pg/repository/pg-maintenance.gateway.js";
import { PgOutboxGateway } from "../../src/pg/repository/pg-outbox.gateway.js";
import { PgOutboxPublisher } from "../../src/pg/repository/pg-outbox.publisher.js";
import { PgUnitOfWork, ShardScope, TransactionScope } from "../../src/pg/transaction/index.js";
import { openDatabase, seedOrganizationId } from "../support/database.js";

// One node, so nothing is ever placed: every repository here resolves to it.
const shards = new ShardScope();

let database: Database;
let scope: TransactionScope;
let publisher: PgOutboxPublisher;
let gateway: PgOutboxGateway;
let organizationId: OrganizationId;
let actor: Principal;

beforeAll(async () => {
  database = openDatabase();
  scope = new TransactionScope();
  publisher = new PgOutboxPublisher(
    DatabaseCluster.single(database),
    scope,
    shards,
    new SystemClock(),
  );
  gateway = new PgOutboxGateway(DatabaseCluster.single(database), scope, shards);

  organizationId = await seedOrganizationId(database);
  actor = Principal.system(
    organizationId,
    Identifiers.userId.parse(Uuid.v7()) as UserId,
    CapabilitySet.from({ wildcard: false, org: { grants: [], denies: [] }, goals: {} }),
  );

  // **`drain` is node-wide**, so every pending row on this database lands in this
  // spec's batch. Since `24.1` a tenant another spec deleted leaves its events behind.
  // ──
  // The same predicate the nightly orphan pass uses, and the same one `orphan-sweep.ts`
  // runs at teardown — which is too late for rows that existed before this file ran.
  await database.client.execute(sql`
    delete from outbox_event e
    where not exists (select 1 from organizations o where o.id = e.organization_id)
  `);

  // The month this spec writes into has to exist: no DEFAULT partition, on purpose.
  await new PgMaintenanceGateway(
    DatabaseCluster.single(database),
    scope,
    shards,
    new PgUnitOfWork(DatabaseCluster.single(database), scope, shards, "catalog"),
  ).ensureMonthlyPartitions(PartitionedTable.OUTBOX_EVENT, null, new Date(), 1);
});

afterEach(async () => {
  await database.client.execute(
    sql`delete from outbox_event where organization_id = ${organizationId}`,
  );
});

afterAll(async () => {
  await database.close();
});

const publish = () =>
  publisher.publish(actor, {
    name: "member.joined",
    payload: { userId: actor.userId, roleId: Identifiers.roleId.parse(Uuid.v7()) },
  });

const pendingCount = async () => {
  const rows = await database.client.execute<{ count: string }>(
    sql`select count(*)::text as count from outbox_event
        where organization_id = ${organizationId} and published_at is null`,
  );
  return Number(rows.rows[0]?.count ?? "0");
};

describe("PgOutboxGateway.drain", () => {
  it("marks a batch published only after the relay resolves", async () => {
    await publish();

    expect(await gateway.drain(10, () => Promise.resolve())).toBe(1);
    expect(await pendingCount()).toBe(0);
  });

  // A throw has to leave the rows claimable, or a failing subscriber silently loses the
  // event — and claimable at once, not a lease later.
  it("leaves the rows pending, and free, when the relay throws", async () => {
    await publish();

    await expect(gateway.drain(10, () => Promise.reject(new Error("queue down")))).rejects.toThrow(
      "queue down",
    );
    expect(await pendingCount()).toBe(1);
    expect(await gateway.drain(10, () => Promise.resolve())).toBe(1);
  });

  // `CR.27`: the relay is Redis round trips, and holding the claim's transaction open
  // across them held row locks and the node's xmin for the whole batch.
  it("relays with no transaction open", async () => {
    await publish();
    let open: unknown = "not called";

    await gateway.drain(10, () => {
      open = scope.current();
      return Promise.resolve();
    });

    expect(open).toBeUndefined();
  });

  // A drain that dies mid-relay commits nothing more; its lease is what frees the rows.
  it("skips a row under another drain's lease, and takes it once the lease passes", async () => {
    await publish();
    await database.client.execute(sql`
      update outbox_event set claimed_until = now() + interval '1 hour'
      where organization_id = ${organizationId}
    `);

    expect(await gateway.drain(10, () => Promise.resolve())).toBe(0);

    await database.client.execute(sql`
      update outbox_event set claimed_until = now() - interval '1 second'
      where organization_id = ${organizationId}
    `);

    expect(await gateway.drain(10, () => Promise.resolve())).toBe(1);
    expect(await pendingCount()).toBe(0);
  });

  // `SKIP LOCKED` is what lets two worker replicas share the drain with no coordinator.
  // Without it the second call blocks and then hands out the same rows.
  it("never hands the same row to two concurrent drains", async () => {
    await publish();
    await publish();

    const seen: string[] = [];
    const collect = (events: readonly { id: string }[]) => {
      seen.push(...events.map((event) => event.id));
      return Promise.resolve();
    };

    await Promise.all([gateway.drain(10, collect), gateway.drain(10, collect)]);

    expect(seen).toHaveLength(2);
    expect(new Set(seen).size).toBe(2);
  });

  it("reports nothing to drain rather than failing on an empty outbox", async () => {
    expect(await gateway.drain(10, () => Promise.resolve())).toBe(0);
  });

  it("reports no lag when nothing is pending, which is not the same as unknown", async () => {
    expect(await gateway.oldestPendingAt()).toBeNull();
  });
});

describe("PgOutboxPublisher", () => {
  // The property the whole design exists for: the row and the state change that caused
  // it commit together or not at all.
  it("rolls the event back with the transaction that wrote it", async () => {
    const unitOfWork = new PgUnitOfWork(DatabaseCluster.single(database), scope, shards, "catalog");

    await expect(
      unitOfWork.run(async () => {
        await publish();
        throw new Error("state change failed");
      }),
    ).rejects.toThrow("state change failed");

    expect(await pendingCount()).toBe(0);
  });
});
