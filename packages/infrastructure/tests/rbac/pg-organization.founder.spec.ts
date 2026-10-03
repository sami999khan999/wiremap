import { Identifiers, type OrganizationId, type UserId } from "@loadbearing/contracts";
import { SystemClock, Uuid } from "@loadbearing/core";
import { and, eq, inArray, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CacheStore } from "../../src/import.js";
import type { Database } from "../../src/pg/primitive/index.js";
import { DatabaseCluster } from "../../src/pg/primitive/index.js";
import { PgActivityLogger } from "../../src/pg/repository/pg-activity.logger.js";
import { PgOrganizationFounder } from "../../src/pg/repository/pg-organization.founder.js";
import { PgShardResolver } from "../../src/pg/repository/pg-shard.resolver.js";
import {
  activityLog,
  memberships,
  organizations,
  roles,
  spareTenants,
  users,
} from "../../src/pg/schema/index.js";
import { TenantPartitionSeed } from "../../src/pg/seed/index.js";
import { ShardScope, TransactionScope } from "../../src/pg/transaction/index.js";
import { openDatabase } from "../support/database.js";
import { RecordingLogger } from "../support/recording.logger.js";

// One node, so nothing is ever placed: every repository here resolves to it.
const shards = new ShardScope();

let database: Database;
const created: UserId[] = [];

const makeUser = async (name = "Ada") => {
  const id = Identifiers.userId.parse(Uuid.v7());
  await database.client.insert(users).values({
    id,
    name,
    email: `${id}@example.test`,
    emailVerified: true,
  });
  created.push(id);
  return id;
};

// The founder and its logger share one scope on purpose: that is what puts the audit
// row inside the founding transaction, and the last test depends on it.
const founder = (scope = new TransactionScope()) =>
  new PgOrganizationFounder(
    DatabaseCluster.single(database),
    scope,
    shards,
    new PgActivityLogger(DatabaseCluster.single(database), scope, shards, new SystemClock()),
    new RecordingLogger(),
  );

beforeAll(() => {
  database = openDatabase();
});

afterAll(async () => {
  if (created.length > 0) {
    const owned = await database.client
      .select({ organizationId: memberships.organizationId })
      .from(memberships)
      .where(inArray(memberships.userId, created));

    await database.client.delete(users).where(inArray(users.id, created));

    for (const row of owned) {
      // The column carries no brand, and `organizations.id` does — parsed rather than
      // cast, so a row that is not a uuid fails here instead of in the driver.
      const organizationId = Identifiers.organizationId.parse(row.organizationId);
      await database.client.delete(roles).where(eq(roles.organizationId, organizationId));
      await database.client.delete(organizations).where(eq(organizations.id, organizationId));
    }
  }
  await database.close();
});

// One spare made by hand, the way the worker's top-up makes one: row and partitions.
const makeSpare = async (): Promise<OrganizationId> => {
  const id = Identifiers.organizationId.parse(Uuid.v7());
  await database.client.insert(spareTenants).values({ id });
  await new TenantPartitionSeed(
    DatabaseCluster.single(database),
    new TransactionScope(),
    shards,
  ).run(id);
  return id;
};

const spareIds = async (): Promise<readonly string[]> =>
  (await database.client.select({ id: spareTenants.id }).from(spareTenants)).map((row) => row.id);

// `PF.3`. The pool is shared, and a running worker may hold spares of its own, so each
// case compares against what was there rather than assuming it was empty.
describe("PgOrganizationFounder, the spare pool", () => {
  it("founds the tenant on a spare, and the pool no longer holds it", async () => {
    await makeSpare();
    const before = await spareIds();

    const organizationId = await founder().found(await makeUser(), "Spare Co");

    expect(before).toContain(organizationId);
    expect(await spareIds()).not.toContain(organizationId);
  });

  // `SKIP LOCKED` falls through rather than queueing, so a pool somebody else holds is
  // an empty pool — and an empty pool seeds inline, exactly as before spares existed.
  it("seeds inline when every spare is held by another signup", async () => {
    await makeSpare();
    const holder = openDatabase();
    let release = (): void => {};
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    let locked = (): void => {};
    const holding = new Promise<void>((resolve) => {
      locked = resolve;
    });

    const held = holder.client.transaction(async (tx) => {
      await tx.execute(sql`select id from spare_tenants for update`);
      locked();
      await released;
    });

    try {
      await holding;
      const before = await spareIds();

      const organizationId = await founder().found(await makeUser(), "Inline Co");

      expect(before).not.toContain(organizationId);
      expect(await spareIds()).toEqual(before);
    } finally {
      release();
      await held;
      await holder.close();
    }
  });
});

describe("PgOrganizationFounder", () => {
  it("founds an organization the user owns, seeded with the four system roles", async () => {
    const userId = await makeUser();

    const organizationId = await founder().found(userId, "Acme");

    const [membership] = await database.client
      .select({ roleId: memberships.roleId })
      .from(memberships)
      .where(and(eq(memberships.userId, userId), eq(memberships.organizationId, organizationId)));
    const [role] = await database.client
      .select({ key: roles.key })
      .from(roles)
      .where(eq(roles.id, membership?.roleId ?? ""));
    const seeded = await database.client
      .select({ key: roles.key })
      .from(roles)
      .where(eq(roles.organizationId, organizationId));

    expect(role?.key).toBe("owner");
    expect(seeded.map((r) => r.key).sort()).toEqual([
      "admin",
      "guest",
      "member",
      "owner",
      "project_admin",
      "project_editor",
      "project_viewer",
      "viewer",
    ]);
  });

  it("names the row as told and slugs from the organization id unless given one", async () => {
    const userId = await makeUser();

    const defaulted = await founder().found(userId, "Acme");
    const explicit = await founder().found(userId, "Personal", `u-${userId}`);

    const rows = await database.client
      .select({ id: organizations.id, name: organizations.name, slug: organizations.slug })
      .from(organizations)
      .where(inArray(organizations.id, [defaulted, explicit]));

    expect(rows.find((r) => r.id === defaulted)).toEqual({
      id: defaulted,
      name: "Acme",
      slug: `o-${defaulted}`,
    });
    expect(rows.find((r) => r.id === explicit)?.slug).toBe(`u-${userId}`);
  });

  // The audit row is written as the *new* tenant, which is the only tenant the fact
  // belongs to — the founder may well be acting from a session in another one.
  it("records organization.created in the new tenant's audit log", async () => {
    const userId = await makeUser();

    const organizationId = await founder().found(userId, "Audited");

    const rows = await database.client
      .select({ actorId: activityLog.actorId, payload: activityLog.payload })
      .from(activityLog)
      .where(
        and(
          eq(activityLog.organizationId, organizationId),
          eq(activityLog.action, "organization.created"),
        ),
      );

    expect(rows).toHaveLength(1);
    expect(rows[0]?.actorId).toBe(userId);
    expect(rows[0]?.payload).toEqual({ name: "Audited" });
  });

  // What lets the personal enroller call this inside its own locked transaction: the
  // founding becomes a savepoint, and an abort above it takes the tenant with it.
  it("becomes a savepoint inside an enclosing transaction and rolls back with it", async () => {
    const userId = await makeUser();
    const scope = new TransactionScope();
    const subject = founder(scope);
    let organizationId: OrganizationId | undefined;

    await expect(
      database.client.transaction(async (tx) =>
        scope.within(tx, "catalog", async () => {
          organizationId = await subject.found(userId, "Doomed");
          throw new Error("abort");
        }),
      ),
    ).rejects.toThrow("abort");

    // Thrown rather than asserted: the query below needs the id, and "the founder
    // returned nothing" is a different failure from "the row survived the rollback".
    if (organizationId === undefined) throw new Error("found returned no organization");

    const rows = await database.client
      .select({ id: organizations.id })
      .from(organizations)
      .where(eq(organizations.id, organizationId));

    expect(rows).toHaveLength(0);
  });
});

// The resolver's cache, in memory. The defect below is the resolver reading a directory
// row through its own pool, so the cache only has to exist, not to be Redis.
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

// **Found by signing up against the two-node stack, 2026-09-25.** On more than one node the
// audit row asks where its tenant lives, and the resolver reads the directory through
// ──
// its own pool — which cannot see the row this uncommitted transaction just wrote. Every
// signup failed with "No shard assignment". One physical database, indexed twice, is two.
describe("PgOrganizationFounder on a cluster of more than one node", () => {
  const twoNodes = () =>
    DatabaseCluster.of(
      [
        { pooled: database, direct: database },
        { pooled: database, direct: database },
      ],
      new PgShardResolver(
        () => database,
        () => new MapCache(),
        () => new RecordingLogger(),
      ),
    );

  it("founds a tenant and writes its audit row in the founding transaction", async () => {
    const userId = await makeUser("Grace");
    const scope = new TransactionScope();
    const cluster = twoNodes();
    const subject = new PgOrganizationFounder(
      cluster,
      scope,
      shards,
      new PgActivityLogger(cluster, scope, shards, new SystemClock()),
      new RecordingLogger(),
    );

    const organizationId = await subject.found(userId, "Two nodes");

    const audit = await database.client
      .select({ action: activityLog.action })
      .from(activityLog)
      .where(eq(activityLog.organizationId, organizationId));
    expect(audit).toEqual([{ action: "organization.created" }]);
  });
});

// `RV.14`. The column default only placed the orgs that existed when it was added; a new
// signup lands on whatever the platform chose, and on `unlimited` before anyone chose.
describe("PgOrganizationFounder — the default plan", () => {
  const plan = `spec-default-${Uuid.v7()}`;
  const founded: OrganizationId[] = [];

  const setDefault = (key: string) =>
    database.client.execute(
      sql`insert into platform_policy (id, default_plan_key) values (1, ${key})
          on conflict (id) do update set default_plan_key = excluded.default_plan_key`,
    );

  const planOf = async (organizationId: OrganizationId) =>
    (
      await database.client
        .select({ key: organizations.planKey })
        .from(organizations)
        .where(eq(organizations.id, organizationId))
    )[0]?.key;

  afterAll(async () => {
    await setDefault("unlimited");
    if (founded.length > 0) {
      await database.client
        .update(organizations)
        .set({ planKey: "unlimited" })
        .where(inArray(organizations.id, founded));
    }
    await database.client.execute(sql`delete from plans where key = ${plan}`);
  });

  it("founds an org on the platform's default plan", async () => {
    await database.client.execute(sql`insert into plans (key, name) values (${plan}, ${"Spec"})`);
    await setDefault(plan);

    const organizationId = await founder().found(await makeUser(), "Planned Co");
    founded.push(organizationId);

    expect(await planOf(organizationId)).toBe(plan);
  });

  it("founds on unlimited when the default is unlimited", async () => {
    await setDefault("unlimited");

    const organizationId = await founder().found(await makeUser(), "Unplanned Co");
    founded.push(organizationId);

    expect(await planOf(organizationId)).toBe("unlimited");
  });
});
