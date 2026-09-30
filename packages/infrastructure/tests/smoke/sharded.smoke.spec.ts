import { PartitionedTable, Shard } from "@loadbearing/application";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import {
  CacheStore,
  CapabilitySet,
  migrate,
  type OrganizationId,
  Principal,
  sql,
  type UserId,
  Uuid,
} from "../../src/import.js";
import { Database, DatabaseCluster } from "../../src/pg/primitive/index.js";
import {
  PgMaintenanceGateway,
  PgNotificationRepository,
  PgOutboxGateway,
  PgOutboxPublisher,
  PgShardResolver,
} from "../../src/pg/repository/index.js";
import { TenantPartitionSeed } from "../../src/pg/seed/index.js";
import { PgUnitOfWork, ShardScope, TransactionScope } from "../../src/pg/transaction/index.js";
import { RecordingLogger } from "../support/recording.logger.js";
import type {} from "./support/stack.js";

const stack = inject("stack");
const shard1 = stack.shard1;

// A spec's own double, which is what keeps this rehearsal about the routing seam:
// `RedisCacheStore` would put a second service between it and the thing it rehearses.
class MapCache extends CacheStore {
  private readonly held = new Map<string, unknown>();

  public override async get<T>(key: string): Promise<T | null> {
    return (this.held.get(key) as T) ?? null;
  }

  public override async set<T>(key: string, value: T): Promise<void> {
    this.held.set(key, value);
  }

  public override async setIfAbsent<T>(key: string, value: T): Promise<boolean> {
    if (this.held.has(key)) return false;
    this.held.set(key, value);
    return true;
  }

  public override async delete(key: string): Promise<void> {
    this.held.delete(key);
  }

  public override async deletePrefix(prefix: string): Promise<void> {
    for (const key of [...this.held.keys()]) if (key.startsWith(prefix)) this.held.delete(key);
  }
}

describe.skipIf(!shard1)("a two-node cluster", () => {
  // `skipIf` skips the tests, not this body: vitest still runs it to register them. So
  // the guard is what keeps a skipped run from opening four pools nothing will close.
  if (!shard1) return;

  const logger = new RecordingLogger();
  const shards = new ShardScope();
  const scope = new TransactionScope();
  const cache = new MapCache();

  // Opened here rather than through the cluster, because the assertions read both nodes
  // directly: the point is where a row physically landed, not where a port says it is.
  const catalog = new Database({ url: stack.database.url });
  const catalogDirect = new Database({ url: stack.database.directUrl });
  const node1 = new Database({ url: shard1.url });
  const node1Direct = new Database({ url: shard1.directUrl });

  const resolver = new PgShardResolver(
    () => catalog,
    () => cache,
    () => logger,
  );

  const cluster = DatabaseCluster.of(
    [
      { pooled: catalog, direct: catalogDirect },
      { pooled: node1, direct: node1Direct },
    ],
    resolver,
  );

  // Two tenants, one per node. Created here rather than taken from the seed: the seed
  // places the bootstrap organization on node 0, and this needs one that is not there.
  const onNodeZero = Uuid.v7() as OrganizationId;
  const onNodeOne = Uuid.v7() as OrganizationId;
  const author = Uuid.v7() as UserId;

  const notifications = new PgNotificationRepository(cluster, scope, shards);

  // One routed row, told apart by its event id: the dedupe index makes that id unique.
  const notify = (organizationId: OrganizationId, eventId: string) =>
    notifications.saveMany([
      {
        organizationId,
        userId: author,
        eventId,
        kind: "member.joined",
        category: "membership",
        params: {},
        link: null,
        subjectId: null,
        createdAt: new Date(),
      },
    ]);

  const place = async (organizationId: OrganizationId, node: number) => {
    await catalog.client.execute(sql`
      insert into organizations (id, slug, name)
      values (${organizationId}::uuid, ${`rehearsal-${organizationId}`}, 'Rehearsal')
    `);
    await catalog.client.execute(sql`
      insert into shard_assignments (shard_key, node)
      values (${organizationId}, ${node})
    `);
  };

  beforeAll(async () => {
    // Both nodes, the same migrations folder: a shard is not a different schema, and a
    // rehearsal that migrated one would fail on a missing table rather than on the seam.
    for (const node of [catalogDirect, node1Direct]) {
      await migrate(node.client, { migrationsFolder: "./migrations" });
    }

    await catalog.client.execute(sql`
      insert into users (id, name, email, email_verified)
      values (${author}::uuid, 'Rehearsal', ${`${author}@example.test`}, true)
    `);

    await place(onNodeZero, 0);
    await place(onNodeOne, 1);

    // A partition is physical, so each tenant's are created on its own node.
    await new TenantPartitionSeed(DatabaseCluster.single(catalogDirect), scope, shards).run(
      onNodeZero,
    );
    await new TenantPartitionSeed(DatabaseCluster.single(node1Direct), scope, shards).run(
      onNodeOne,
    );
  });

  afterAll(async () => {
    // A partition outlives the row that caused it: the deletes below cascade rows away
    // and leave the tables, so every run would strand a tenant's on the node it seeded.
    for (const [direct, organizationId] of [
      [catalogDirect, onNodeZero],
      [node1Direct, onNodeOne],
    ] as const) {
      const node = DatabaseCluster.single(direct);
      await new PgMaintenanceGateway(
        node,
        scope,
        shards,
        new PgUnitOfWork(node, scope, shards, "catalog"),
      ).dropTenantPartitions(organizationId);
    }

    for (const organizationId of [onNodeZero, onNodeOne]) {
      await catalog.client.execute(
        sql`delete from shard_assignments where shard_key = ${organizationId}`,
      );
      await catalog.client.execute(
        sql`delete from organizations where id = ${organizationId}::uuid`,
      );
    }
    await catalog.client.execute(sql`delete from users where id = ${author}::uuid`);

    await Promise.all([catalog.close(), catalogDirect.close(), node1.close(), node1Direct.close()]);
  });

  const placedOn = async <T>(organizationId: OrganizationId, work: () => Promise<T>) => {
    const key = Shard.keyOf(organizationId);
    return shards.within({ key, node: await resolver.resolve(key) }, work);
  };

  // `to_regclass` rather than a catalog join: it answers null instead of throwing, and
  // the question here is only whether the relation is on this node at all.
  const relationExists = async (database: Database, name: string) => {
    const found = await database.client.execute<{ present: boolean }>(
      sql`select to_regclass(${name}) is not null as present`,
    );
    return found.rows[0]?.present === true;
  };

  const notificationRowsOn = async (database: Database, eventId: string) => {
    const found = await database.client.execute<{ count: string }>(
      sql`select count(*)::text as count from notifications where event_id = ${eventId}::uuid`,
    );
    return Number(found.rows[0]?.count ?? 0);
  };

  // Both cross-node passes opened their transaction through the **catalog** unit of
  // work, which never reads `ShardScope` — so the loop ran and every node got node 0.
  // ──
  // The runway is the half provable without `24.1`: a month partition needs no key.
  it("creates the month partition on the node the loop is walking", async () => {
    const period = new Date(Date.UTC(2033, 6, 1));
    const parent = TenantPartitionSeed.partitionName(PartitionedTable.ACTIVITY_LOG, onNodeOne);
    const child = `${parent}_2033_07`;

    // Built exactly as `Container` builds it: one cluster spanning both nodes, and a
    // `local` unit of work. With a catalog one this lands on node 0 instead.
    const maintenance = new PgMaintenanceGateway(
      cluster,
      scope,
      shards,
      new PgUnitOfWork(cluster, scope, shards, "local"),
    );

    await placedOn(onNodeOne, () =>
      maintenance.ensureMonthlyPartitions(PartitionedTable.ACTIVITY_LOG, onNodeOne, period, 1),
    );

    expect(await relationExists(node1Direct, child)).toBe(true);
    // The other half of the assertion, and the one that fails on the old binding: the
    // partition must not have been created on the catalog node.
    expect(await relationExists(catalogDirect, child)).toBe(false);

    await node1Direct.client.execute(sql.raw(`drop table if exists ${child}`));
    await catalogDirect.client.execute(sql.raw(`drop table if exists ${child}`));
  });

  // `R.2`'s other half, owed since `24.1` removed the `23503` that blocked it. The drain
  // walks nodes with the `local` unit of work, so node 1's events are drained from node 1.
  it("drains a tenant's event from the outbox on the node it was written to", async () => {
    const routedWork = new PgUnitOfWork(cluster, scope, shards, "routed");
    const publisher = new PgOutboxPublisher(cluster, scope, shards, { now: () => new Date() });
    const outbox = new PgOutboxGateway(cluster, scope, shards);
    const entryId = Uuid.v7();
    const actor = new Principal(onNodeOne, author, CapabilitySet.empty());

    await placedOn(onNodeOne, () =>
      routedWork.run(() =>
        publisher.publish(actor, {
          name: "activity.recorded",
          payload: { entryId, action: "rehearsal.drained", payload: {} },
        }),
      ),
    );

    const pendingOn = async (database: Database) => {
      const found = await database.client.execute<{ published: boolean }>(sql`
        select published_at is not null as published from outbox_event
        where organization_id = ${onNodeOne}::uuid
          and payload ->> 'entryId' = ${entryId}
      `);
      return found.rows;
    };

    expect(await pendingOn(node1Direct)).toEqual([{ published: false }]);
    expect(await pendingOn(catalogDirect)).toEqual([]);

    const relayed: string[] = [];
    await shards.atNode(1, () =>
      outbox.drain(100, async (events) => {
        for (const event of events) {
          const payload = event.payload as { entryId?: string };
          if (payload.entryId) relayed.push(payload.entryId);
        }
      }),
    );

    expect(relayed).toContain(entryId);
    expect(await pendingOn(node1Direct)).toEqual([{ published: true }]);

    await node1Direct.client.execute(
      sql`delete from outbox_event where organization_id = ${onNodeOne}::uuid`,
    );
  });

  it("resolves each tenant to the node its directory row names", async () => {
    expect(await resolver.resolve(Shard.keyOf(onNodeZero))).toBe(0);
    expect(await resolver.resolve(Shard.keyOf(onNodeOne))).toBe(1);
  });

  it("keeps the directory on the catalog, and only there", async () => {
    const onCatalog = await catalog.client.execute<{ count: string }>(sql`
      select count(*)::text as count from shard_assignments
      where shard_key in (${onNodeZero}, ${onNodeOne})
    `);
    const onShard = await node1.client.execute<{ count: string }>(sql`
      select count(*)::text as count from shard_assignments
      where shard_key in (${onNodeZero}, ${onNodeOne})
    `);

    expect(Number(onCatalog.rows[0]?.count)).toBe(2);
    expect(Number(onShard.rows[0]?.count)).toBe(0);
  });

  it("writes a routed row to the node the tenant is placed on, and to no other", async () => {
    const eventId = Uuid.v7();

    await placedOn(onNodeZero, () => notify(onNodeZero, eventId));

    expect(await notificationRowsOn(catalog, eventId)).toBe(1);
    expect(await notificationRowsOn(node1, eventId)).toBe(0);
  });

  // **The split's first real cost, paid.** This case used to assert the `23503`: ten
  // foreign keys crossed to the catalog and a routed insert on node 1 could not land.
  // ──
  // `24.1` dropped them, so the assertion inverts — the write succeeds, on node 1, with
  // the catalog untouched. It fails on the old schema, which is the point of keeping it.
  it("writes a routed row on node 1 with no key reaching back to the catalog", async () => {
    const eventId = Uuid.v7();

    expect(await placedOn(onNodeOne, () => notify(onNodeOne, eventId))).toEqual([author]);
    expect(await notificationRowsOn(node1, eventId)).toBe(1);
    expect(await notificationRowsOn(catalog, eventId)).toBe(0);
  });

  // The other half of the same decision: `author` is a `users` row that exists only on
  // the catalog, and the write above named it precisely because nothing checks.
  it("accepts an author the shard has never heard of", async () => {
    const strangers = await node1.client.execute<{ count: string }>(
      sql`select count(*)::text as count from users where id = ${author}`,
    );

    expect(Number(strangers.rows[0]?.count ?? "0")).toBe(0);
  });
});
