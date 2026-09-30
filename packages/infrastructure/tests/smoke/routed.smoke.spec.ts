import { Shard } from "@loadbearing/application";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { migrate, type OrganizationId, sql, type UserId, Uuid } from "../../src/import.js";
import { Database, DatabaseCluster } from "../../src/pg/primitive/index.js";
import {
  PgMaintenanceGateway,
  PgNotificationRepository,
  PgShardResolver,
} from "../../src/pg/repository/index.js";
import { TenantPartitionSeed } from "../../src/pg/seed/index.js";
import { PgUnitOfWork, ShardScope, TransactionScope } from "../../src/pg/transaction/index.js";
import { RedisCacheStore, RedisConnection } from "../../src/redis/index.js";
import { RecordingLogger } from "../support/recording.logger.js";
import type {} from "./support/stack.js";

// `24.6`: what routing costs a request, then routed writes under load at 1x and 10x on two
// nodes. Opt-in with `ROUTED_SCALE`. See docs/reference/sharding.md.

const stack = inject("stack");
const shard1 = stack.shard1;

// How many resolutions each reading averages over. One is noise; a thousand is a number.
const RESOLVES = 1_000;

describe.skipIf(!shard1 || !stack.routed)("what routing costs a request", () => {
  // `skipIf` skips the tests, not this body: vitest still runs it to register them.
  if (!shard1 || !stack.routed) return;

  const logger = new RecordingLogger();

  const catalog = new Database({ url: stack.database.url });
  const catalogDirect = new Database({ url: stack.database.directUrl });
  const node1 = new Database({ url: shard1.url });

  // The real cache, not a spec's Map: the warm path is a Redis round trip, and pretending
  // otherwise would report a resolution cost the deployment never pays.
  const redis = new RedisConnection(stack.redis);
  const cache = new RedisCacheStore(redis.client());

  const resolver = new PgShardResolver(
    () => catalog,
    () => cache,
    () => logger,
  );

  const placed = Uuid.v7() as OrganizationId;
  const readings: { readonly path: string; readonly perCallUs: number }[] = [];

  const timed = async (work: () => Promise<void>): Promise<number> => {
    const started = performance.now();
    await work();
    return performance.now() - started;
  };

  const per = (ms: number): number => Math.round((ms * 1_000) / RESOLVES);

  beforeAll(async () => {
    await migrate(catalogDirect.client, { migrationsFolder: "./migrations" });

    await catalog.client.execute(sql`
      insert into organizations (id, slug, name)
      values (${placed}::uuid, ${`routed-${placed}`}, 'Routed')
    `);
    await catalog.client.execute(sql`
      insert into shard_assignments (shard_key, node) values (${placed}, 1)
    `);
  });

  afterAll(async () => {
    if (readings.length > 0) console.table(readings);

    await resolver.invalidate(Shard.keyOf(placed));
    await catalog.client.execute(sql`delete from shard_assignments where shard_key = ${placed}`);
    await catalog.client.execute(sql`delete from organizations where id = ${placed}::uuid`);

    await redis.close();
    await Promise.all([catalog.close(), catalogDirect.close(), node1.close()]);
  });

  // **The number every routed request pays.** The miss is measured apart from the
  // invalidation that forces it, or it reads one round trip larger than it is.
  it("resolves a placement in one cache read, and a miss in one query more", async () => {
    const key = Shard.keyOf(placed);

    await resolver.resolve(key);
    const warm = await timed(async () => {
      for (let attempt = 0; attempt < RESOLVES; attempt += 1) await resolver.resolve(key);
    });

    const invalidateOnly = await timed(async () => {
      for (let attempt = 0; attempt < RESOLVES; attempt += 1) await resolver.invalidate(key);
    });

    const both = await timed(async () => {
      for (let attempt = 0; attempt < RESOLVES; attempt += 1) {
        await resolver.invalidate(key);
        await resolver.resolve(key);
      }
    });

    readings.push(
      { path: "warm — one cache read", perCallUs: per(warm) },
      {
        path: "cold — cache read, catalog query, cache write",
        perCallUs: per(both - invalidateOnly),
      },
      { path: "cache invalidate, for reference", perCallUs: per(invalidateOnly) },
    );

    // The warm path is the one every request takes, and it has to be the cheap one. A
    // factor of two is a floor rather than a target: it is what makes this stable.
    expect(warm).toBeLessThan(both - invalidateOnly);
    expect(await resolver.resolve(key)).toBe(1);
  });

  // A cross-tenant pass loops **nodes**, serially — `Container.eachShard`. Measured here
  // because a pass that fanned out would hold a connection open on every node at once.
  it("walks both nodes serially, which is what every cross-tenant pass does", async () => {
    const seen: number[] = [];

    const walk = await timed(async () => {
      for (const [index, node] of [catalog, node1].entries()) {
        await node.client.execute(sql`select count(*) from notifications`);
        seen.push(index);
      }
    });

    readings.push({ path: `walk both nodes — ${Math.round(walk)} ms for two`, perCallUs: 0 });
    expect(seen).toEqual([0, 1]);
  });
});

// **The write half, unblocked by `24.1`.** Tenants on both nodes; every write is the path a
// request takes: a placement read through the real cache, then a routed transaction.
describe.skipIf(!shard1 || !stack.routed)("routed writes under load", () => {
  if (!shard1 || !stack.routed) return;

  // `DATABASE_POOL_MAX`'s shipped default, per node: what one process holds.
  const POOL = 20;
  const TENANTS_PER_NODE = 4;
  // 1x is four writers at once and 10x is forty. Writes per level from `ROUTED_SCALE`.
  const LEVELS = [
    { label: "1x", writers: 4 },
    { label: "10x", writers: 40 },
  ] as const;
  const writes = stack.routed[0] ?? 1_000;
  // Per level. A commit is an `fsync`, and on Docker Desktop that alone is ~100 ms.

  const logger = new RecordingLogger();
  const catalog = new Database({ url: stack.database.url, maxConnections: POOL });
  const catalogDirect = new Database({ url: stack.database.directUrl });
  const node1 = new Database({ url: shard1.url, maxConnections: POOL });
  const node1Direct = new Database({ url: shard1.directUrl });
  const redis = new RedisConnection(stack.redis);
  const cache = new RedisCacheStore(redis.client());
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
  const shards = new ShardScope();
  const scope = new TransactionScope();
  const routed = new PgUnitOfWork(cluster, scope, shards, "routed");
  const notifications = new PgNotificationRepository(cluster, scope, shards);

  const reader = Uuid.v7() as UserId;
  const tenants: { id: OrganizationId; node: number }[] = [];
  const acknowledged = new Map<OrganizationId, string[]>();
  const readings: Record<string, string | number>[] = [];

  const placed = async <T>(organizationId: OrganizationId, work: () => Promise<T>) => {
    const key = Shard.keyOf(organizationId);
    const placement = await resolver.placementOf(key);
    return shards.within({ key, node: placement.node, frozen: placement.frozen }, work);
  };

  const percentile = (sorted: readonly number[], share: number): number =>
    Math.round((sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * share))] ?? 0) * 10) /
    10;

  beforeAll(async () => {
    for (const direct of [catalogDirect, node1Direct]) {
      await migrate(direct.client, { migrationsFolder: "./migrations" });
    }

    for (const node of [0, 1]) {
      for (let n = 0; n < TENANTS_PER_NODE; n += 1) {
        const id = Uuid.v7() as OrganizationId;
        await catalog.client.execute(sql`
          insert into organizations (id, slug, name)
          values (${id}::uuid, ${`load-${id}`}, 'Routed load')
        `);
        await catalog.client.execute(
          sql`insert into shard_assignments (shard_key, node) values (${id}, ${node})`,
        );
        const direct = node === 0 ? catalogDirect : node1Direct;
        await new TenantPartitionSeed(DatabaseCluster.single(direct), scope, shards).run(id);

        tenants.push({ id, node });
        acknowledged.set(id, []);
      }
    }
  });

  afterAll(async () => {
    if (readings.length > 0) console.table(readings);

    for (const tenant of tenants) {
      const direct = tenant.node === 0 ? catalogDirect : node1Direct;
      const node = DatabaseCluster.single(direct);
      await new PgMaintenanceGateway(
        node,
        scope,
        shards,
        new PgUnitOfWork(node, scope, shards, "catalog"),
      ).dropTenantPartitions(tenant.id);
      await resolver.invalidate(Shard.keyOf(tenant.id));
      await catalog.client.execute(
        sql`delete from shard_assignments where shard_key = ${tenant.id}`,
      );
      await catalog.client.execute(sql`delete from organizations where id = ${tenant.id}::uuid`);
    }

    await redis.close();
    await Promise.all([catalog.close(), catalogDirect.close(), node1.close(), node1Direct.close()]);
  });

  it.each(LEVELS)(
    "takes $label concurrent writers with no error",
    async ({ label, writers }) => {
      const latencies: number[] = [];
      const failures: unknown[] = [];
      let next = 0;

      const writer = async () => {
        for (let at = next++; at < writes; at = next++) {
          const tenant = tenants[at % tenants.length];
          if (!tenant) continue;
          // One event per write, so the dedupe index never folds two of them into one row.
          const id = Uuid.v7();
          const started = performance.now();
          try {
            await placed(tenant.id, () =>
              routed.run(() =>
                notifications.saveMany([
                  {
                    organizationId: tenant.id,
                    userId: reader,
                    eventId: id,
                    kind: "member.joined",
                    category: "membership",
                    params: { level: `${label} ${at}` },
                    link: null,
                    subjectId: null,
                    createdAt: new Date(),
                  },
                ]),
              ),
            );
            latencies.push(performance.now() - started);
            acknowledged.get(tenant.id)?.push(id);
          } catch (error) {
            failures.push(error);
          }
        }
      };

      const started = performance.now();
      await Promise.all(Array.from({ length: writers }, () => writer()));
      const elapsed = performance.now() - started;

      const sorted = latencies.toSorted((left, right) => left - right);
      readings.push({
        level: label,
        writers,
        writes: latencies.length,
        "writes/s": Math.round((latencies.length * 1_000) / elapsed),
        "p50 ms": percentile(sorted, 0.5),
        "p95 ms": percentile(sorted, 0.95),
        "p99 ms": percentile(sorted, 0.99),
        errors: failures.length,
      });

      expect(failures).toEqual([]);
      expect(latencies).toHaveLength(writes);
    },
    600_000,
  );

  // Every acknowledged write on its tenant's node, and none of a tenant's rows on the
  // other: a routing slip under load would be a row that reads back from nowhere.
  it("put every acknowledged row on its tenant's node and nowhere else", async () => {
    const count = async (database: Database, organizationId: OrganizationId) =>
      Number(
        (
          await database.client.execute<{ count: string }>(sql`
            select count(*)::text as count from notifications where organization_id = ${organizationId}::uuid
          `)
        ).rows[0]?.count ?? 0,
      );

    for (const tenant of tenants) {
      const ids = acknowledged.get(tenant.id) ?? [];
      const [home, away] = tenant.node === 0 ? [catalog, node1] : [node1, catalog];

      expect(await count(home, tenant.id)).toBe(ids.length);
      expect(await count(away, tenant.id)).toBe(0);
    }
  });
});
