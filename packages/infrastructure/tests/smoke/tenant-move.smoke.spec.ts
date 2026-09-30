import {
  ActivityRelaySubscriber,
  PartitionedTable,
  type PlatformPolicyRepository,
  type PlatformReader,
  ReclaimMoveSourcesUseCase,
  RelocateTenantUseCase,
  Shard,
} from "@loadbearing/application";
import { DomainEvents } from "@loadbearing/contracts";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import {
  type ActivityLogger,
  CacheStore,
  CapabilitySet,
  type ConversationId,
  ForbiddenError,
  type MessageId,
  migrate,
  type OrganizationId,
  Principal,
  sql,
  type UserId,
  Uuid,
} from "../../src/import.js";
import { Database, DatabaseCluster } from "../../src/pg/primitive/index.js";
import {
  PgActivityLogger,
  PgConversationRepository,
  PgMaintenanceGateway,
  PgMessageRepository,
  PgShardAssignmentRepository,
  PgShardResolver,
  PgTenantMoveGateway,
} from "../../src/pg/repository/index.js";
import { TenantPartitionSeed } from "../../src/pg/seed/index.js";
import { PgUnitOfWork, ShardScope, TransactionScope } from "../../src/pg/transaction/index.js";
import { RecordingLogger } from "../support/recording.logger.js";
import type {} from "./support/stack.js";

const stack = inject("stack");
const shard1 = stack.shard1;

// The resolver's cache, shared by the writers and the directory: the freeze reaches a
// writer through this invalidation and no other way, which is what the case rehearses.
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

// `24.5`'s second clause: a tenant moved under load, with no acknowledged write lost.
describe.skipIf(!shard1)("a tenant move between two nodes", () => {
  // `skipIf` skips the tests, not this body, so the guard keeps a skipped run from
  // opening pools nothing will close.
  if (!shard1) return;

  const logger = new RecordingLogger();
  const shards = new ShardScope();
  const scope = new TransactionScope();
  const cache = new MapCache();

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

  const tenant = Uuid.v7() as OrganizationId;
  const key = Shard.keyOf(tenant);
  const author = Uuid.v7() as UserId;

  // A month the seed's runway does not cover. Its rows have nowhere to land on the
  // target unless the move mirrors the source's months rather than seeding fresh ones.
  const OLD = new Date(Date.UTC(2025, 0, 15));
  const oldMonth = `${TenantPartitionSeed.partitionName(PartitionedTable.MESSAGES, tenant)}_2025_01`;

  const conversations = new PgConversationRepository(cluster, scope, shards);
  const messages = new PgMessageRepository(cluster, scope, shards);
  const routed = new PgUnitOfWork(cluster, scope, shards, "routed");
  const assignments = new PgShardAssignmentRepository(cluster, scope, shards, resolver);
  const move = new PgTenantMoveGateway(cluster, scope, shards, resolver, { settleMs: 300 });

  const policy = {
    get: () => Promise.resolve({ moveGraceDays: null }),
  } as unknown as PlatformPolicyRepository;
  const platform = {
    organizationId: () => Promise.resolve(tenant),
  } as unknown as PlatformReader;
  const activity: ActivityLogger = { record: () => Promise.resolve() };

  const relocate = new RelocateTenantUseCase(
    assignments,
    move,
    policy,
    platform,
    activity,
    { now: () => new Date() },
    7,
  );

  let conversationId: ConversationId;

  // How a request places itself: once, off the resolver, before any write. That the
  // placement can be stale by the time the write runs is the case being tested.
  const placed = async <T>(work: () => Promise<T>): Promise<T> => {
    const placement = await resolver.placementOf(key);
    return shards.within({ key, node: placement.node, frozen: placement.frozen }, work);
  };

  // `thinkMs` is the request's work between placing itself and writing, and `holdMs`
  // its work after writing and before commit — the two gaps the quiesce waits out.
  const write = (body: string, createdAt = new Date(), thinkMs = 0, holdMs = 0) => {
    const id = Uuid.v7() as MessageId;
    return placed(async () => {
      if (thinkMs > 0) await new Promise((resolve) => setTimeout(resolve, thinkMs));
      return routed.run(async () => {
        await messages.save({
          id,
          createdAt,
          organizationId: tenant,
          conversationId,
          authorId: author,
          clientId: Uuid.v7(),
          body,
        });
        if (holdMs > 0) await new Promise((resolve) => setTimeout(resolve, holdMs));
        return id;
      });
    });
  };

  const count = async (database: Database, table: string, where = sql``) => {
    const found = await database.client.execute<{ count: string }>(sql`
      select count(*)::text as count from ${sql.raw(table)}
      where organization_id = ${tenant} ${where}
    `);
    return Number(found.rows[0]?.count ?? 0);
  };

  const exists = async (database: Database, name: string) => {
    const found = await database.client.execute<{ present: boolean }>(
      sql`select to_regclass(${`public.${name}`}) is not null as present`,
    );
    return found.rows[0]?.present === true;
  };

  beforeAll(async () => {
    for (const node of [catalogDirect, node1Direct]) {
      await migrate(node.client, { migrationsFolder: "./migrations" });
    }

    await catalog.client.execute(sql`
      insert into users (id, name, email, email_verified)
      values (${author}::uuid, 'Mover', ${`${author}@example.test`}, true)
    `);
    await catalog.client.execute(sql`
      insert into organizations (id, slug, name)
      values (${tenant}::uuid, ${`move-${tenant}`}, 'Move rehearsal')
    `);
    await catalog.client.execute(
      sql`insert into shard_assignments (shard_key, node) values (${tenant}, 0)`,
    );

    await new TenantPartitionSeed(DatabaseCluster.single(catalogDirect), scope, shards).run(tenant);

    const parent = TenantPartitionSeed.partitionName(PartitionedTable.MESSAGES, tenant);
    await catalogDirect.client.execute(
      sql.raw(`create table ${oldMonth} (like ${parent} including all)`),
    );
    await catalogDirect.client.execute(
      sql.raw(
        `alter table ${parent} attach partition ${oldMonth} for values from ('2025-01-01') to ('2025-02-01')`,
      ),
    );

    conversationId = (await placed(() =>
      conversations.save({
        organizationId: tenant,
        kind: "channel",
        title: "move",
        directKey: null,
        createdBy: author,
        memberIds: [author],
      }),
    )) as ConversationId;

    await write("from last year", OLD);
    for (let n = 0; n < 20; n += 1) await write(`before ${n}`);

    // One audit row, written where a catalog transaction would write it.
    await catalog.client.execute(sql`
      insert into activity_log (id, organization_id, actor_id, action, payload, occurred_at)
      values (${Uuid.v7()}::uuid, ${tenant}::uuid, ${author}::uuid, 'member.invited', '{}', now())
    `);
  });

  afterAll(async () => {
    for (const direct of [catalogDirect, node1Direct]) {
      const node = DatabaseCluster.single(direct);
      await new PgMaintenanceGateway(
        node,
        scope,
        shards,
        new PgUnitOfWork(node, scope, shards, "catalog"),
      ).dropTenantPartitions(tenant);
      await direct.client.execute(sql`delete from outbox_event where organization_id = ${tenant}`);
    }

    await catalog.client.execute(sql`delete from shard_assignments where shard_key = ${tenant}`);
    await catalog.client.execute(sql`delete from organizations where id = ${tenant}::uuid`);
    await catalog.client.execute(sql`delete from users where id = ${author}::uuid`);

    await Promise.all([catalog.close(), catalogDirect.close(), node1.close(), node1Direct.close()]);
  });

  it("moves under load, and every acknowledged write is on the target", async () => {
    const acknowledged: MessageId[] = [];
    let refused = 0;
    let running = true;

    // Four writers, each placing itself per write the way a request does. A refused
    // write is the freeze working; an acknowledged one must survive the move.
    const writer = async (name: number) => {
      for (let n = 0; running; n += 1) {
        try {
          acknowledged.push(await write(`writer ${name} write ${n}`, new Date(), 20));
        } catch (error) {
          if (!(error instanceof ForbiddenError)) throw error;
          refused += 1;
        }
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
    };

    const writers = [0, 1, 2, 3].map((name) => writer(name));

    // **`24.2b`.** A job placed on node 0 before the move and writing only after the flip,
    // long past the settle. Placed the way `withShard` places one: with `recheck`.
    let flipped: () => void = () => undefined;
    const afterFlip = new Promise<void>((resolve) => {
      flipped = resolve;
    });
    const lateJobId = Uuid.v7() as MessageId;
    const before = await resolver.placementOf(key);
    const lateJob = shards.within({ key, node: before.node, recheck: true }, async () => {
      await afterFlip;
      return routed
        .run(() =>
          messages.save({
            id: lateJobId,
            createdAt: new Date(),
            organizationId: tenant,
            conversationId,
            authorId: author,
            clientId: Uuid.v7(),
            body: "late job",
          }),
        )
        .then(
          () => "wrote",
          (error: unknown) => error,
        );
    });

    // **The deterministic half.** A write already inside its transaction when the move
    // starts, and still uncommitted when the copy would read its page without the lock.
    const straggler = write("straggler", new Date(), 0, 1500);
    await new Promise((resolve) => setTimeout(resolve, 200));

    const moved = await relocate.execute({ organizationId: tenant, toNode: 1, actorId: author });
    flipped();

    // Keep writing after the flip: those land on node 1 directly, through the fresh
    // placement the flip's invalidation forces.
    await new Promise((resolve) => setTimeout(resolve, 200));
    running = false;
    await Promise.all(writers);
    acknowledged.push(await straggler);

    expect(moved.fromNode).toBe(0);
    expect(refused).toBeGreaterThan(0);
    expect(acknowledged.length).toBeGreaterThan(0);

    const landed = await node1.client.execute<{ count: string }>(sql`
      select count(*)::text as count from messages
      where organization_id = ${tenant} and id = any(${`{${acknowledged.join(",")}}`}::uuid[])
    `);
    expect(Number(landed.rows[0]?.count)).toBe(acknowledged.length);

    expect(await assignments.findByKey(key)).toMatchObject({ node: 1, movedFrom: 0 });

    // Refused, and so on neither node: without the recheck it lands on node 0, after its
    // page was copied, and the reclaim drops it.
    const late = await lateJob;
    expect(late).toBeInstanceOf(ForbiddenError);
    for (const database of [catalog, node1]) {
      expect(await count(database, "messages", sql`and id = ${lateJobId}::uuid`)).toBe(0);
    }
  });

  it("carries a month the target's runway never had", async () => {
    expect(await exists(node1Direct, oldMonth)).toBe(true);
    expect(await count(node1, "messages", sql`and body = 'from last year'`)).toBe(1);
  });

  it("carries the audit row the catalog wrote", async () => {
    expect(await count(node1, "activity_log")).toBe(1);
  });

  // `24.2a`. A catalog transaction runs on node 0; for a tenant that now lives on node 1
  // its audit row is saved in node 0's outbox in that transaction, never in node 0's log.
  const audit = new PgActivityLogger(cluster, scope, shards, { now: () => new Date() });
  const catalogWork = new PgUnitOfWork(cluster, scope, shards, "catalog");
  const relay = new ActivityRelaySubscriber(audit);
  const actor = new Principal(tenant, author, CapabilitySet.empty());

  const relayedOnNodeZero = async () =>
    catalogDirect.client.execute<Record<string, unknown>>(sql`
      select id::text as id, organization_id::text as "organizationId", name,
             actor_id::text as "actorId", payload, occurred_at as "occurredAt"
      from outbox_event
      where organization_id = ${tenant} and name = 'activity.recorded'
    `);

  it("sends a catalog write's audit row for a moved tenant through node 0's outbox", async () => {
    const before = await count(catalog, "activity_log");

    await placed(() =>
      catalogWork.run(() => audit.record(actor, "member.invited", { email: "late@example.test" })),
    );

    expect(await count(catalog, "activity_log")).toBe(before);
    expect((await relayedOnNodeZero()).rows).toHaveLength(1);
  });

  it("writes the relayed row on the tenant's node, once however often it arrives", async () => {
    const before = await count(node1, "activity_log");
    const [row] = (await relayedOnNodeZero()).rows;
    const event = DomainEvents.parse(row);

    // Twice, because the outbox is at-least-once and a redelivery is the normal case.
    await placed(() => relay.handle(event));
    await placed(() => relay.handle(event));

    expect(await count(node1, "activity_log")).toBe(before + 1);
    expect(
      await count(node1, "activity_log", sql`and payload ->> 'email' = 'late@example.test'`),
    ).toBe(1);
  });

  // The grace period ends and the whole source goes, the catalog node's audit partition
  // included — after a row that landed there between the verify and the flip is carried.
  it("reclaims the source, carrying a late audit row before it drops node 0's copy", async () => {
    const stray = Uuid.v7();
    await catalogDirect.client.execute(sql`
      insert into activity_log (id, organization_id, actor_id, action, payload, occurred_at)
      values (${stray}::uuid, ${tenant}::uuid, ${author}::uuid, 'member.invited', '{}', now())
    `);

    const reclaim = new ReclaimMoveSourcesUseCase(assignments, move, {
      now: () => new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    });

    await reclaim.execute();

    const messagesPartition = TenantPartitionSeed.partitionName(PartitionedTable.MESSAGES, tenant);
    const auditPartition = TenantPartitionSeed.partitionName(PartitionedTable.ACTIVITY_LOG, tenant);

    expect(await exists(catalogDirect, messagesPartition)).toBe(false);
    expect(await exists(catalogDirect, auditPartition)).toBe(false);
    expect(await count(node1, "activity_log", sql`and id = ${stray}::uuid`)).toBe(1);
    expect(await count(node1, "messages")).toBeGreaterThan(20);
    expect(await assignments.findByKey(key)).toMatchObject({ node: 1, movedFrom: null });
  });
});
