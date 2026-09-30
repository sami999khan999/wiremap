import { PartitionedTable, type PartitionedTableName } from "@loadbearing/application";
import {
  Identifiers,
  type NotificationId,
  type OrganizationId,
  type UserId,
} from "@loadbearing/contracts";
import { Uuid } from "@loadbearing/core";
import { and, asc, eq, type Logger, sql } from "drizzle-orm";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "../../src/pg/primitive/index.js";
import { DatabaseCluster, KeysetCursor } from "../../src/pg/primitive/index.js";
import { PgActivityReplayReader } from "../../src/pg/repository/pg-activity-replay.reader.js";
import { PgMaintenanceGateway } from "../../src/pg/repository/pg-maintenance.gateway.js";
import { PgNotificationRepository } from "../../src/pg/repository/pg-notification.repository.js";
import { PgNotificationPreferenceRepository } from "../../src/pg/repository/pg-notification-preference.repository.js";
import { PgOutboxGateway } from "../../src/pg/repository/pg-outbox.gateway.js";
import { PgVectorStore } from "../../src/pg/repository/pg-vector.store.js";
import {
  activityLog,
  notifications,
  organizations,
  outboxEvent,
  users,
} from "../../src/pg/schema/index.js";
import { TenantPartitionSeed } from "../../src/pg/seed/index.js";
import { PgUnitOfWork, ShardScope, TransactionScope } from "../../src/pg/transaction/index.js";
import { DATABASE_URL, dropTenant, openDatabase, seedTenant } from "../support/database.js";

// One node, so nothing is ever placed: every repository here resolves to it.
const shards = new ShardScope();

// Routed repositories refuse to pick a pool with no shard in scope, which is the
// tripwire working. One node here, so entering it is the whole placement.
const placeOnTheOneNode = () => shards.enter({ key: "spec" as never, node: 0 });

// Both hooks, and registered first: vitest runs every `beforeAll` before any
// `beforeEach`, and a fixture built in one of those makes routed queries too.
beforeAll(placeOnTheOneNode);
beforeEach(placeOnTheOneNode);

// The ruler every retention change after this one is measured with: a predicate that
// stops naming a partition key is a plan nobody reads until production is slow.

// Captures every statement as drizzle issues it, so the EXPLAIN below plans the query
// under test rather than a hand-written copy of it that drifts.
class RecordingLogger implements Logger {
  public readonly statements: { query: string; params: unknown[] }[] = [];

  public logQuery(query: string, params: unknown[]): void {
    this.statements.push({ query, params });
  }
}

// One leaf partition, and which tenant and month it belongs to. Two levels since `0023`:
// `<table>_<32hex>` splits by tenant and `_<yyyy>_<mm>` splits that by month.
interface Leaf {
  readonly name: string;
  readonly tenant: string;
  readonly month: number | null;
}

const recorder = new RecordingLogger();

let database: Database;
let explain: Pool;
let inbox: PgNotificationRepository;
let preferences: PgNotificationPreferenceRepository;
let corpus: PgVectorStore;
let replay: PgActivityReplayReader;
let outbox: PgOutboxGateway;
let organizationId: OrganizationId;
let neighbour: OrganizationId;
let reader: UserId;
let written: { id: NotificationId; createdAt: Date };

// A unit vector, the shape `pg-vector.store.spec.ts` uses. The values do not matter
// here: this file asserts on plans, not on what came back.
const axis = (index: number): number[] =>
  Array.from({ length: 1536 }, (_, i) => (i === index ? 1 : 0));

// Two months far enough out that no migration and no other spec owns them, so this file
// creates every partition it reads and drops every one it created.
const FIRST = new Date("2032-05-01T00:00:00.000Z");
const SECOND = new Date("2032-06-01T00:00:00.000Z");

const notification = (organization: OrganizationId, createdAt: Date) => ({
  organizationId: organization,
  userId: reader,
  eventId: Uuid.v7(),
  kind: "member.joined" as const,
  category: "membership" as const,
  params: {},
  link: null,
  subjectId: null,
  createdAt,
});

// Rows in both months, under both tenants. The neighbour is what makes "one tenant
// partition" an assertion rather than a tautology on a database holding one tenant.
const writeRows = async (organization: OrganizationId) => {
  await inbox.saveMany([notification(organization, FIRST), notification(organization, SECOND)]);

  for (const at of [FIRST, SECOND]) {
    await database.client.insert(activityLog).values({
      id: Uuid.v7(),
      organizationId: organization,
      actorId: reader,
      action: "task.reactivated",
      payload: {},
      occurredAt: at,
    });

    await database.client.insert(outboxEvent).values({
      id: Uuid.v7(),
      organizationId: organization,
      actorId: reader,
      name: "task.reactivated",
      payload: {},
      occurredAt: at,
      // Written already drained, so the claim this spec plans can never take one of
      // these rows and no other spec's view of the queue moves underneath it.
      publishedAt: at,
    });
  }

  // The tables with a tenant level and no month level that a read below plans against.
  // One row each is enough: the cases assert which subtree is read, not what it found.
  await preferences.save(organization, reader, {
    category: "membership",
    channel: "email",
    mode: "digest",
  });
  await corpus.upsert(organization, [
    {
      id: Uuid.v7(),
      sourceId: Uuid.v7(),
      goalId: null,
      content: "pruning",
      embedding: axis(0),
      metadata: { chunkIndex: 0, sourceType: "note" },
    },
  ]);
};

const founded = async (name: string): Promise<OrganizationId> => {
  const id = Identifiers.organizationId.parse(Uuid.v7());
  await database.client.insert(organizations).values({ id, slug: `pruning-${id}`, name });
  await seedTenant(database, id);
  return id;
};

beforeAll(async () => {
  database = openDatabase(recorder);
  explain = new Pool({ connectionString: DATABASE_URL });

  const scope = new TransactionScope();
  const unitOfWork = new PgUnitOfWork(DatabaseCluster.single(database), scope, shards, "catalog");
  inbox = new PgNotificationRepository(DatabaseCluster.single(database), scope, shards);
  preferences = new PgNotificationPreferenceRepository(
    DatabaseCluster.single(database),
    scope,
    shards,
  );
  corpus = new PgVectorStore(DatabaseCluster.single(database), scope, shards);
  replay = new PgActivityReplayReader(DatabaseCluster.single(database), scope, shards);
  outbox = new PgOutboxGateway(DatabaseCluster.single(database), scope, shards);

  reader = Identifiers.userId.parse(Uuid.v7());
  await database.client
    .insert(users)
    .values({ id: reader, name: "Pruning", email: `${reader}@example.test` });

  // Both tenants are this file's own, never the seeded one: a tenant of its own is one
  // `dropTenantPartitions` to clean up, and leaves nothing for the next spec to find.
  [organizationId, neighbour] = [await founded("Mine"), await founded("Neighbour")];

  const maintenance = new PgMaintenanceGateway(
    DatabaseCluster.single(database),
    scope,
    shards,
    unitOfWork,
  );
  for (const entry of PartitionedTable.MONTH_PARTITIONED) {
    for (const tenant of entry.tenantKey ? [organizationId, neighbour] : [null]) {
      await maintenance.ensureMonthlyPartitions(entry.name, tenant, FIRST, 2);
    }
  }

  await writeRows(organizationId);
  await writeRows(neighbour);

  const [row] = await database.client
    .select({ id: notifications.id, createdAt: notifications.createdAt })
    .from(notifications)
    .where(and(eq(notifications.organizationId, organizationId), eq(notifications.userId, reader)))
    .orderBy(asc(notifications.createdAt))
    .limit(1);

  if (!row) throw new Error("expected the two notifications above to have been written");
  written = { id: row.id as NotificationId, createdAt: row.createdAt };
});

afterAll(async () => {
  // Both tenants go whole — every tenant partition and its months — which takes every
  // row this file wrote to a tenant-owned table with them.
  for (const organization of [organizationId, neighbour]) {
    await dropTenant(database, organization);
    await database.client.delete(organizations).where(eq(organizations.id, organization));
  }

  // `outbox_event` is the one table with no tenant level, so its two months are the only
  // partitions left holding this file's rows.
  for (const entry of PartitionedTable.MONTH_PARTITIONED) {
    if (entry.tenantKey) continue;
    for (const month of ["2032_05", "2032_06"]) {
      await database.client.execute(sql.raw(`drop table if exists ${entry.name}_${month}`));
    }
  }

  await database.client.delete(users).where(eq(users.id, reader));
  await explain.end();
  await database.close();
});

// The statement the method issued, picked out of the handful a unit of work wraps
// around it. Never a copy written beside the repository, which is the thing that drifts.
const capture = async (
  run: () => Promise<unknown>,
  match: RegExp,
): Promise<{ query: string; params: unknown[] }> => {
  recorder.statements.length = 0;
  await run();

  const statement = recorder.statements.find(({ query }) => match.test(query));
  if (!statement) throw new Error(`no statement matching ${match} was issued`);
  return statement;
};

const childrenOf = async (parent: string): Promise<readonly string[]> => {
  const rows = await database.client.execute<{ name: string }>(sql`
    select child.relname as name
    from pg_inherits
    join pg_class parent on parent.oid = pg_inherits.inhparent
    join pg_class child on child.oid = pg_inherits.inhrelid
    where parent.relname = ${parent}
    order by child.relname
  `);

  return rows.rows.map((row) => row.name);
};

// `<parent>_<yyyy>_<mm>` as a month index, null for a child this file did not name — the
// floor assertions leave those alone rather than guess which month they hold.
const monthOf = (parent: string, name: string): number | null => {
  const escaped = parent.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`^${escaped}_(\\d{4})_(\\d{2})$`).exec(name);
  if (!match?.[1] || !match[2]) return null;
  return Number(match[1]) * 12 + Number(match[2]) - 1;
};

const monthIndex = (at: Date): number => at.getUTCFullYear() * 12 + at.getUTCMonth();

// Read from the catalog every time: other specs create and drop months of their own, and
// a list captured once is one this file would go on asserting against after it moved.
const leavesOf = async (table: PartitionedTableName): Promise<readonly Leaf[]> => {
  const entry = PartitionedTable.byName(table);
  const leaves: Leaf[] = [];

  if (!entry.tenantKey) {
    for (const name of await childrenOf(table)) {
      leaves.push({ name, tenant: table, month: monthOf(table, name) });
    }
    return leaves;
  }

  for (const tenant of await childrenOf(table)) {
    if (!entry.column) {
      leaves.push({ name: tenant, tenant, month: null });
      continue;
    }
    for (const name of await childrenOf(tenant)) {
      leaves.push({ name, tenant, month: monthOf(tenant, name) });
    }
  }

  return leaves;
};

const relationsIn = (node: unknown, into: Set<string>): void => {
  if (typeof node !== "object" || node === null) return;

  const plan = node as Record<string, unknown>;
  const name = plan["Relation Name"];
  if (typeof name === "string") into.add(name);

  // Both keys: the top of an `EXPLAIN (FORMAT JSON)` document is `{ "Plan": … }` and
  // every node below it carries its children under `"Plans"`.
  relationsIn(plan.Plan, into);

  const children = plan.Plans;
  if (Array.isArray(children)) for (const child of children) relationsIn(child, into);
};

// `EXPLAIN` and never `EXPLAIN ANALYZE`: nothing executes, which is what makes planning
// an UPDATE and a `FOR UPDATE SKIP LOCKED` against live rows safe.
const scanned = async (
  statement: { query: string; params: unknown[] },
  table: PartitionedTableName,
): Promise<readonly Leaf[]> => {
  const explained = await explain.query(
    `explain (format json) ${statement.query}`,
    statement.params,
  );

  const root: unknown = explained.rows[0]?.["QUERY PLAN"];
  const plans: unknown = typeof root === "string" ? JSON.parse(root) : root;

  const relations = new Set<string>();
  if (Array.isArray(plans)) for (const entry of plans) relationsIn(entry, relations);

  // Intersected with the catalog rather than matched by name shape, so the parent a
  // ModifyTable node names is never counted as a partition that was scanned.
  return (await leavesOf(table)).filter((leaf) => relations.has(leaf.name));
};

// True of every read in the system since `0023`, and the assertion that catches a
// predicate that lost its tenant: the neighbour's subtree is not in the plan.
const oneTenant = (leaves: readonly Leaf[], table: PartitionedTableName) => {
  const mine = TenantPartitionSeed.partitionName(table, organizationId);
  expect(leaves.length).toBeGreaterThan(0);
  expect([...new Set(leaves.map((leaf) => leaf.tenant))]).toEqual([mine]);
};

const olderThan = (leaves: readonly Leaf[], floor: Date) =>
  leaves.filter((leaf) => leaf.month !== null && leaf.month < monthIndex(floor));

// Every leaf under this tenant's partition, which is what the unbounded reads scan.
const everyMonthOf = async (table: PartitionedTableName): Promise<readonly string[]> => {
  const mine = TenantPartitionSeed.partitionName(table, organizationId);
  return (await leavesOf(table)).filter((leaf) => leaf.tenant === mine).map((leaf) => leaf.name);
};

describe("one tenant partition, for every read there is", () => {
  it("prunes the neighbour's subtree out of an inbox page", async () => {
    const statement = await capture(
      () => inbox.list(organizationId, reader, { limit: 20, unreadOnly: false }),
      /from "notifications"/i,
    );

    oneTenant(await scanned(statement, PartitionedTable.NOTIFICATIONS), "notifications");
  });

  // Tables with a tenant level and no month level under it, so "one tenant partition"
  // is the whole assertion: there is nothing narrower to prune to.
  const tenantOnly: readonly [string, PartitionedTableName, RegExp, () => Promise<unknown>][] = [
    [
      "the preference lookup",
      PartitionedTable.NOTIFICATION_PREFERENCES,
      /from "notification_preferences"/i,
      () => preferences.findFor(organizationId, [reader], "membership"),
    ],
    [
      "the preference list",
      PartitionedTable.NOTIFICATION_PREFERENCES,
      /from "notification_preferences"/i,
      () => preferences.listFor(organizationId, reader),
    ],
    [
      "the vector search",
      PartitionedTable.DOCUMENT_CHUNKS,
      /from "document_chunks"/i,
      () => corpus.search(organizationId, axis(0), [], 10),
    ],
    [
      "the source delete",
      PartitionedTable.DOCUMENT_CHUNKS,
      /delete from "document_chunks"/i,
      // Planned, never executed: `EXPLAIN` without `ANALYZE` runs nothing, which is what
      // makes a delete safe to measure against the rows the other cases read.
      () => corpus.deleteBySource(organizationId, Uuid.v7()),
    ],
  ];

  for (const [what, table, match, run] of tenantOnly) {
    it(`prunes the neighbour's subtree out of ${what}`, async () => {
      oneTenant(await scanned(await capture(run, match), table), table);
    });
  }
});

describe("exactly one month, for the reads carrying an equality or a closed range", () => {
  it("markRead plans against the one month its createdAt names", async () => {
    const statement = await capture(
      () => inbox.markRead(organizationId, reader, written.id, written.createdAt, new Date()),
      /update "notifications"/i,
    );

    const leaves = await scanned(statement, PartitionedTable.NOTIFICATIONS);
    oneTenant(leaves, "notifications");
    expect(leaves.map((leaf) => leaf.month)).toEqual([monthIndex(FIRST)]);
  });

  it("the activity rollup plans against the one month its range falls inside", async () => {
    const statement = await capture(
      () => replay.dailyCounts(organizationId, FIRST, new Date("2032-05-02T00:00:00.000Z")),
      /from "activity_log"/i,
    );

    // Cross-tenant by design until `16.6` makes the projection per tenant, so this one
    // asserts the month level alone: one month, in every tenant that has one.
    const leaves = await scanned(statement, PartitionedTable.ACTIVITY_LOG);
    expect(leaves.length).toBeGreaterThan(0);
    expect([...new Set(leaves.map((leaf) => leaf.month))]).toEqual([monthIndex(FIRST)]);
  });
});

describe("the retention tail is pruned, for the reads that carry a floor", () => {
  // A floor cannot prune a *future* month — rows could legitimately land in one — so this
  // is the strongest honest assertion: nothing older than the floor is in the plan.
  it("listUnreadBetween leaves out every month before its floor", async () => {
    const statement = await capture(
      // An end past every planted month: the claim is about the floor pruning the tail.
      () => inbox.listUnreadBetween(organizationId, [reader], SECOND, new Date("2099-01-01"), 50),
      /from "notifications"/i,
    );

    const leaves = await scanned(statement, PartitionedTable.NOTIFICATIONS);
    oneTenant(leaves, "notifications");
    expect(olderThan(leaves, SECOND)).toEqual([]);
    // And not vacuously: the floor's own month is still there to be read.
    expect(leaves.map((leaf) => leaf.month)).toContain(monthIndex(SECOND));
  });

  it("the projection walk leaves out every month before its checkpoint", async () => {
    const statement = await capture(
      () =>
        replay.since(
          organizationId,
          { lastOccurredAt: SECOND, lastId: "00000000-0000-0000-0000-000000000000" },
          100,
          [],
          // Past every month this spec plants: the claim is about the floor pruning the
          // tail, and a horizon would prune the head instead and prove nothing.
          new Date("2099-01-01T00:00:00.000Z"),
        ),
      /from "activity_log"/i,
    );

    const leaves = await scanned(statement, PartitionedTable.ACTIVITY_LOG);
    expect(olderThan(leaves, SECOND)).toEqual([]);
    expect(leaves.map((leaf) => leaf.month)).toContain(monthIndex(SECOND));
  });
});

// `PF.6`: a later page carries `created_at <= at` beside its row-constructor cursor. The
// pruner does not decompose the row constructor; it does read the bare comparison.
describe("bounded by the cursor's month, for the pages after the first", () => {
  // Every `Index Cond` in the plan. The cursor must stay inside one: rewritten as an
  // `OR` it prunes too, but falls out of the index into a row-by-row `Filter`.
  const conditions = async (statement: { query: string; params: unknown[] }) => {
    const explained = await explain.query(
      `explain (format json) ${statement.query}`,
      statement.params,
    );
    const root: unknown = explained.rows[0]?.["QUERY PLAN"];
    const plans: unknown = typeof root === "string" ? JSON.parse(root) : root;

    const nodes: string[] = [];
    const walk = (node: unknown): void => {
      if (typeof node !== "object" || node === null) return;
      const plan = node as Record<string, unknown>;
      if (typeof plan["Index Cond"] === "string") nodes.push(plan["Index Cond"]);
      walk(plan.Plan);
      if (Array.isArray(plan.Plans)) for (const child of plan.Plans) walk(child);
    };
    if (Array.isArray(plans)) for (const entry of plans) walk(entry);
    return nodes;
  };

  it("the inbox's next page drops every month newer than its cursor", async () => {
    const next = await capture(
      () =>
        inbox.list(organizationId, reader, {
          limit: 20,
          unreadOnly: false,
          cursor: KeysetCursor.encode(FIRST, written.id),
        }),
      /from "notifications"/i,
    );

    const leaves = await scanned(next, PartitionedTable.NOTIFICATIONS);
    oneTenant(leaves, "notifications");
    expect(leaves.map((leaf) => leaf.month)).toContain(monthIndex(FIRST));
    expect(leaves.map((leaf) => leaf.month)).not.toContain(monthIndex(SECOND));
    expect(leaves.every((leaf) => (leaf.month ?? 0) <= monthIndex(FIRST))).toBe(true);

    const cursorIn = await conditions(next);
    expect(cursorIn).toHaveLength(leaves.length);
    for (const condition of cursorIn) expect(condition).toContain("ROW(created_at, id) <");
  });
});

// Today's behaviour, asserted on purpose: a first page has no cursor, so nothing bounds
// it and these read every month there is — see docs/reference/partitions.md.
describe("pinned at every month of the tenant, for the reads that carry no bound", () => {
  const pinned = async (
    statement: { query: string; params: unknown[] },
    table: PartitionedTableName,
  ) => {
    const leaves = await scanned(statement, table);
    expect(leaves.map((leaf) => leaf.name)).toEqual(await everyMonthOf(table));
  };

  it("the inbox's first page reads every month", async () => {
    const first = await capture(
      () => inbox.list(organizationId, reader, { limit: 20, unreadOnly: false }),
      /from "notifications"/i,
    );
    await pinned(first, PartitionedTable.NOTIFICATIONS);
  });

  it("the bell count reads every month", async () => {
    const statement = await capture(
      () => inbox.countUnread(organizationId, reader, 99),
      /from notifications/i,
    );

    await pinned(statement, PartitionedTable.NOTIFICATIONS);
  });

  it("the suppression check reads every month", async () => {
    const statement = await capture(
      () => inbox.unreadSubjectHolders(organizationId, [reader], "member.role.changed", Uuid.v7()),
      /from "notifications"/i,
    );

    await pinned(statement, PartitionedTable.NOTIFICATIONS);
  });

  it("mark-all-read writes across every month", async () => {
    const statement = await capture(
      () => inbox.markAllRead(organizationId, reader, new Date()),
      /update "notifications"/i,
    );

    await pinned(statement, PartitionedTable.NOTIFICATIONS);
  });

  // The one table with no tenant level, so "every partition" is still every month: the
  // drain polls this once a second and must not touch a partition per tenant to do it.
  it("the outbox drain claims across every month", async () => {
    const rolled = new Error("the drain is planned here, never committed");

    const statement = await capture(
      () =>
        outbox
          .drain(10, () => Promise.reject(rolled))
          .catch((error: unknown) => {
            if (error !== rolled) throw error;
          }),
      /skip locked/i,
    );

    const leaves = await scanned(statement, PartitionedTable.OUTBOX_EVENT);
    expect(leaves.map((leaf) => leaf.name)).toEqual(
      (await leavesOf(PartitionedTable.OUTBOX_EVENT)).map((leaf) => leaf.name),
    );
  });
});
