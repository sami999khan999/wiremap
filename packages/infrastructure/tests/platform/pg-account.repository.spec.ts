import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { OrganizationId, UserId } from "../../src/import.js";
import type { Database } from "../../src/pg/primitive/index.js";
import { DatabaseCluster } from "../../src/pg/primitive/index.js";
import { PgAccountRepository } from "../../src/pg/repository/pg-account.repository.js";
import { memberships, permissionOverrides, roles, users } from "../../src/pg/schema/index.js";
import { PlatformRoleSeed, SystemRoleSeed } from "../../src/pg/seed/index.js";
import { ShardScope, TransactionScope } from "../../src/pg/transaction/index.js";
import { openDatabase, seedOrganizationId } from "../support/database.js";

const shards = new ShardScope();
const KEY = "platform.account.manage";

let database: Database;
let tier: OrganizationId;
// Two platform admins, and a plain owner of the tier who holds no platform key.
let first: UserId;
let second: UserId;
let owner: UserId;
const created: UserId[] = [];

const repository = () =>
  new PgAccountRepository(DatabaseCluster.single(database), new TransactionScope(), shards);

const userNamed = async (label: string): Promise<UserId> => {
  const id = crypto.randomUUID() as UserId;
  await database.client
    .insert(users)
    .values({ id, name: label, email: `${label}-${id}@test.local` });
  created.push(id);
  return id;
};

const memberOf = async (userId: UserId, roleKey: string) => {
  const [role] = await database.client
    .select({ id: roles.id })
    .from(roles)
    .where(and(eq(roles.organizationId, tier), eq(roles.key, roleKey)));
  if (!role) throw new Error(`no ${roleKey} role — run \`pnpm db:seed\``);
  await database.client
    .insert(memberships)
    .values({ id: crypto.randomUUID(), organizationId: tier, userId, roleId: role.id });
};

const denyRecovery = (userId: UserId, authority: "org" | "platform") =>
  database.client.insert(permissionOverrides).values({
    id: crypto.randomUUID(),
    organizationId: tier,
    userId,
    goalId: null,
    permission: KEY,
    effect: "deny",
    reason: "spec",
    expiresAt: null,
    authority,
  });

beforeAll(async () => {
  database = openDatabase();
  const scope = new TransactionScope();
  tier = await seedOrganizationId(database);
  // Idempotent, and what grants the account keys to `platform_admin` on a database seeded
  // before they existed.
  await new SystemRoleSeed(DatabaseCluster.single(database), scope, shards).run(tier);
  await new PlatformRoleSeed(DatabaseCluster.single(database), scope, shards).run();

  first = await userNamed("first");
  second = await userNamed("second");
  owner = await userNamed("owner");
  await memberOf(first, "platform_admin");
  await memberOf(second, "platform_admin");
  await memberOf(owner, "owner");
});

afterAll(async () => {
  for (const id of created) {
    await database.client.delete(permissionOverrides).where(eq(permissionOverrides.userId, id));
    await database.client.delete(memberships).where(eq(memberships.userId, id));
    await database.client.delete(users).where(eq(users.id, id));
  }
  await database.close();
});

describe("PgAccountRepository", () => {
  it("finds an account by any casing of its address, with its memberships", async () => {
    const [row] = await database.client
      .select({ email: users.email })
      .from(users)
      .where(eq(users.id, first));

    const account = await repository().findByEmail(` ${row?.email.toUpperCase()} `);

    expect(account?.userId).toBe(first);
    expect(account?.suspendedAt).toBeNull();
    expect(account?.memberships).toEqual([
      expect.objectContaining({ organizationId: tier, deactivated: false }),
    ]);
    expect(await repository().findByEmail("nobody@test.local")).toBeNull();
  });

  it("saves and lifts a suspension", async () => {
    const at = new Date("2026-09-29T00:00:00Z");

    await repository().saveSuspension(owner, at);
    expect((await repository().findById(owner))?.suspendedAt).toEqual(at);

    await repository().saveSuspension(owner, null);
    expect((await repository().findById(owner))?.suspendedAt).toBeNull();
  });

  it("counts holders through the role, and not a member whose role lacks the key", async () => {
    const holders = await repository().holdersOf(tier, KEY);

    expect(holders).toEqual(expect.arrayContaining([first, second]));
    expect(holders).not.toContain(owner);
  });

  // `RV.14` counts what can still act. Each of these three leaves the role grant in place.
  it("drops a suspended, a deactivated and a platform-denied holder", async () => {
    await repository().saveSuspension(first, new Date());
    try {
      expect(await repository().holdersOf(tier, KEY)).not.toContain(first);
    } finally {
      await repository().saveSuspension(first, null);
    }

    await database.client
      .update(memberships)
      .set({ deactivatedAt: new Date() })
      .where(and(eq(memberships.userId, second), eq(memberships.organizationId, tier)));
    try {
      expect(await repository().holdersOf(tier, KEY)).not.toContain(second);
    } finally {
      await database.client
        .update(memberships)
        .set({ deactivatedAt: null })
        .where(and(eq(memberships.userId, second), eq(memberships.organizationId, tier)));
    }

    await denyRecovery(first, "platform");
    const holders = await repository().holdersOf(tier, KEY);
    expect(holders).not.toContain(first);
    expect(holders).toContain(second);
  });

  it("lists the platform's denies on the account, and never an org's", async () => {
    await denyRecovery(second, "org");

    const firstDenies = (await repository().findById(first))?.denies ?? [];
    const secondDenies = (await repository().findById(second))?.denies ?? [];

    expect(firstDenies).toEqual([
      expect.objectContaining({ organizationId: tier, permission: KEY, reason: "spec" }),
    ]);
    expect(secondDenies).toEqual([]);
  });
});
