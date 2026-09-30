import { Identifiers, type UserId } from "@loadbearing/contracts";
import { Uuid } from "@loadbearing/core";
import { eq, inArray, type Logger } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "../../src/pg/primitive/index.js";
import { DatabaseCluster } from "../../src/pg/primitive/index.js";
import { PgCapabilityRepository } from "../../src/pg/repository/pg-capability.repository.js";
import {
  disabledModules,
  entitlementAdjustments,
  memberships,
  organizations,
  permissionOverrides,
  planPermissions,
  plans,
  rolePermissions,
  roles,
  users,
} from "../../src/pg/schema/index.js";
import { ShardScope, TransactionScope } from "../../src/pg/transaction/index.js";
import { openDatabase, seedOrganizationId } from "../support/database.js";

// One node, so nothing is ever placed: every repository here resolves to it.
const shards = new ShardScope();

class CountingLogger implements Logger {
  public count = 0;
  public logQuery(): void {
    this.count += 1;
  }
}

const counter = new CountingLogger();
let database: Database;

beforeAll(() => {
  database = openDatabase(counter);
});

const created: UserId[] = [];

afterAll(async () => {
  if (created.length > 0) {
    await database.client.delete(users).where(inArray(users.id, created));
  }
  await database.close();
});

const makeUser = async () => {
  const id = Identifiers.userId.parse(Uuid.v7());
  await database.client
    .insert(users)
    .values({ id, name: "Ada", email: `${id}@example.test`, emailVerified: true });
  created.push(id);
  return id;
};

describe("PgCapabilityRepository", () => {
  // "Four queries" decays silently — someone adds a lookup inside a loop and it
  // becomes 4 + N, invisible at ten users and fatal at five thousand.
  it("resolves capabilities in exactly four queries", async () => {
    const organizationId = await seedOrganizationId(database);
    const repository = new PgCapabilityRepository(
      DatabaseCluster.single(database),
      new TransactionScope(),
      shards,
    );

    // A well-formed uuid that was never seeded: the columns are `uuid`, so
    // "no-such-user" is a 22P02 rather than the empty result being asserted on.
    const absentUser = Identifiers.userId.parse(Uuid.v7());

    counter.count = 0;
    await repository.resolveFor(organizationId, absentUser);

    expect(counter.count).toBe(4);
  });

  // NULLs are distinct in a unique index, so `(user_id, goal_id, permission)` exempted
  // every org-scope row and duplicates accumulated silently.
  it("refuses a duplicate org-scope override", async () => {
    const organizationId = await seedOrganizationId(database);
    const userId = await makeUser();

    const row = {
      organizationId,
      userId,
      goalId: null,
      permission: "rbac.role.read",
      effect: "grant" as const,
      // Valid under the CHECKs, so the refusal below is the unique index and nothing else.
      reason: "spec",
      expiresAt: new Date(Date.now() + 3_600_000),
    };

    await database.client.insert(permissionOverrides).values({ id: Uuid.v7(), ...row });

    await expect(
      database.client.insert(permissionOverrides).values({ id: Uuid.v7(), ...row }),
    ).rejects.toThrow();

    // Including the contradictory pair, which is the shape that made the accumulation
    // worth catching: `can()` resolves grant-plus-deny to deny either way.
    await expect(
      database.client
        .insert(permissionOverrides)
        .values({ id: Uuid.v7(), ...row, effect: "deny", reason: null, expiresAt: null }),
    ).rejects.toThrow();

    await database.client.delete(permissionOverrides).where(eq(permissionOverrides.userId, userId));
  });

  it("still admits the same permission at org scope and inside a goal", async () => {
    const organizationId = await seedOrganizationId(database);
    const userId = await makeUser();
    const goalId = Uuid.v7();

    const base = { organizationId, userId, permission: "rbac.role.read", effect: "deny" as const };

    await database.client.insert(permissionOverrides).values([
      { id: Uuid.v7(), ...base, goalId: null },
      { id: Uuid.v7(), ...base, goalId },
    ]);

    const rows = await database.client
      .select()
      .from(permissionOverrides)
      .where(eq(permissionOverrides.userId, userId));

    expect(rows).toHaveLength(2);

    await database.client.delete(permissionOverrides).where(eq(permissionOverrides.userId, userId));
  });
});

// The mask inside resolution. Each case founds its own tenant, so a plan change touches
// nothing another spec reads; the kill switch is global, so its case removes its own row.
describe("PgCapabilityRepository — entitlement", () => {
  const run = Uuid.v7();
  const PLAN = `spec-plan-${run}`;
  const ROLE_KEYS = ["rbac.role.read", "apikey.read", "doc.page.read"];
  const founded: string[] = [];

  const repository = () =>
    new PgCapabilityRepository(DatabaseCluster.single(database), new TransactionScope(), shards);

  // A tenant whose one member holds `ROLE_KEYS` through a role and `member.read` through an
  // override grant — both kinds of grant the mask has to reach.
  const tenant = async () => {
    const organizationId = Identifiers.organizationId.parse(Uuid.v7());
    const roleId = Uuid.v7();
    const userId = await makeUser();
    founded.push(organizationId);

    await database.client
      .insert(organizations)
      .values({ id: organizationId, slug: `mask-${organizationId}`, name: "Mask" });
    await database.client
      .insert(roles)
      .values({ id: roleId, organizationId, key: "member", name: "Member", scope: "org" });
    await database.client
      .insert(rolePermissions)
      .values(ROLE_KEYS.map((permission) => ({ organizationId, roleId, permission })));
    await database.client
      .insert(memberships)
      .values({ id: Uuid.v7(), organizationId, userId, roleId });
    await database.client.insert(permissionOverrides).values({
      id: Uuid.v7(),
      organizationId,
      userId,
      goalId: null,
      permission: "member.read",
      effect: "grant",
      reason: "spec",
      expiresAt: new Date(Date.now() + 3_600_000),
    });

    return { organizationId, userId };
  };

  const adjust = (
    organizationId: string,
    permission: string,
    effect: "add" | "remove",
    expiresAt: Date | null = null,
  ) =>
    database.client.insert(entitlementAdjustments).values({
      id: Uuid.v7(),
      organizationId: Identifiers.organizationId.parse(organizationId),
      permission,
      effect,
      reason: "spec",
      expiresAt,
    });

  beforeAll(async () => {
    await database.client.insert(plans).values({ key: PLAN, name: "Spec plan" });
    await database.client.insert(planPermissions).values(
      ["rbac.role.read", "doc.page.read", "member.read"].map((permission) => ({
        planKey: PLAN,
        permission,
      })),
    );
  });

  afterAll(async () => {
    if (founded.length > 0) {
      await database.client.delete(organizations).where(
        inArray(
          organizations.id,
          founded.map((id) => Identifiers.organizationId.parse(id)),
        ),
      );
    }
    await database.client.delete(plans).where(eq(plans.key, PLAN));
  });

  it("resolves an org on unlimited to exactly what its roles and overrides grant", async () => {
    const { organizationId, userId } = await tenant();

    const set = await repository().resolveFor(organizationId, userId);

    expect([...set.toJSON().org.grants].sort()).toEqual([...ROLE_KEYS, "member.read"].sort());
  });

  // Filtered, not deleted: the role row stays, so moving back restores it with no edit.
  it("masks a key the plan leaves out, and restores it when the org moves back", async () => {
    const { organizationId, userId } = await tenant();

    await database.client
      .update(organizations)
      .set({ planKey: PLAN })
      .where(eq(organizations.id, organizationId));
    expect((await repository().resolveFor(organizationId, userId)).can("apikey.read")).toBe(false);

    await database.client
      .update(organizations)
      .set({ planKey: "unlimited" })
      .where(eq(organizations.id, organizationId));
    expect((await repository().resolveFor(organizationId, userId)).can("apikey.read")).toBe(true);
  });

  it("lets a remove mask a role grant and an override grant alike", async () => {
    const { organizationId, userId } = await tenant();
    await adjust(organizationId, "rbac.role.read", "remove");
    await adjust(organizationId, "member.read", "remove");

    const set = await repository().resolveFor(organizationId, userId);

    expect(set.can("rbac.role.read")).toBe(false);
    expect(set.can("member.read")).toBe(false);
    expect(set.can("doc.page.read")).toBe(true);
  });

  it("ignores an adjustment past its expiry", async () => {
    const { organizationId, userId } = await tenant();
    await database.client
      .update(organizations)
      .set({ planKey: PLAN })
      .where(eq(organizations.id, organizationId));
    await adjust(organizationId, "apikey.read", "add", new Date(Date.now() - 60_000));

    const set = await repository().resolveFor(organizationId, userId);

    expect(set.can("apikey.read")).toBe(false);
  });

  it("honours a live add on top of the plan — a trial", async () => {
    const { organizationId, userId } = await tenant();
    await database.client
      .update(organizations)
      .set({ planKey: PLAN })
      .where(eq(organizations.id, organizationId));
    await adjust(organizationId, "apikey.read", "add", new Date(Date.now() + 60_000));

    expect((await repository().resolveFor(organizationId, userId)).can("apikey.read")).toBe(true);
  });

  it("masks every key of a disabled module, and never a core key", async () => {
    const { organizationId, userId } = await tenant();

    await database.client.insert(disabledModules).values({ module: "doc", reason: "spec" });
    try {
      const set = await repository().resolveFor(organizationId, userId);

      expect(set.can("doc.page.read")).toBe(false);
      expect(set.can("rbac.role.read")).toBe(true);
      expect(set.can("core.realtime.subscribe")).toBe(true);
    } finally {
      await database.client.delete(disabledModules).where(eq(disabledModules.module, "doc"));
    }
  });
});

// `AX5.1` and `AX5.2`. A grant lapses and a deny does not; resolution reads only live rows,
// and `explainFor` is the same four statements, unfolded.
describe("PgCapabilityRepository — overrides", () => {
  const repository = () =>
    new PgCapabilityRepository(DatabaseCluster.single(database), new TransactionScope(), shards);

  const override = (
    organizationId: Awaited<ReturnType<typeof seedOrganizationId>>,
    userId: UserId,
    values: Partial<typeof permissionOverrides.$inferInsert>,
  ) =>
    database.client.insert(permissionOverrides).values({
      id: Uuid.v7(),
      organizationId,
      userId,
      goalId: null,
      permission: "apikey.read",
      effect: "grant",
      reason: "spec",
      expiresAt: new Date(Date.now() + 3_600_000),
      ...values,
    });

  it("explains in four statements, and ignores a grant past its expiry", async () => {
    const organizationId = await seedOrganizationId(database);
    const userId = await makeUser();
    await override(organizationId, userId, { permission: "member.read" });
    await override(organizationId, userId, { expiresAt: new Date(Date.now() - 60_000) });

    counter.count = 0;
    const explanation = await repository().explainFor(organizationId, userId);

    expect(counter.count).toBe(4);
    expect(explanation.overrides.map((row) => row.permission)).toEqual(["member.read"]);
    expect((await repository().resolveFor(organizationId, userId)).can("member.read")).toBe(true);
    expect((await repository().resolveFor(organizationId, userId)).can("apikey.read")).toBe(false);

    await database.client.delete(permissionOverrides).where(eq(permissionOverrides.userId, userId));
  });

  // The platform's deny and the org's own row for one key are two facts with two owners.
  it("holds a platform deny beside an org grant of the same key, and the deny wins", async () => {
    const organizationId = await seedOrganizationId(database);
    const userId = await makeUser();
    await override(organizationId, userId, {});
    await override(organizationId, userId, {
      effect: "deny",
      authority: "platform",
      reason: null,
      expiresAt: null,
    });

    const explanation = await repository().explainFor(organizationId, userId);
    expect(explanation.overrides.map((row) => row.authority).sort()).toEqual(["org", "platform"]);
    expect((await repository().resolveFor(organizationId, userId)).can("apikey.read")).toBe(false);

    await database.client.delete(permissionOverrides).where(eq(permissionOverrides.userId, userId));
  });

  it("refuses a grant with no expiry or reason, a deny with one, and a platform grant", async () => {
    const organizationId = await seedOrganizationId(database);
    const userId = await makeUser();

    await expect(override(organizationId, userId, { expiresAt: null })).rejects.toThrow();
    await expect(override(organizationId, userId, { reason: null })).rejects.toThrow();
    await expect(override(organizationId, userId, { effect: "deny" })).rejects.toThrow();
    await expect(override(organizationId, userId, { authority: "platform" })).rejects.toThrow();

    await database.client.delete(permissionOverrides).where(eq(permissionOverrides.userId, userId));
  });
});
