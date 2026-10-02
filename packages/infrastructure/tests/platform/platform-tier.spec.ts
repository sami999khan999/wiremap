import { PermissionRegistry } from "@loadbearing/permissions";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { OrganizationId, UserId } from "../../src/import.js";
import type { Database } from "../../src/pg/primitive/index.js";
import { DatabaseCluster } from "../../src/pg/primitive/index.js";
import { PgCapabilityRepository } from "../../src/pg/repository/pg-capability.repository.js";
import { PgPlatformReader } from "../../src/pg/repository/pg-platform.reader.js";
import {
  memberships,
  organizations,
  permissionOverrides,
  roles,
  users,
} from "../../src/pg/schema/index.js";
import { PlatformRoleSeed, SystemRoleSeed } from "../../src/pg/seed/index.js";
import { ShardScope, TransactionScope } from "../../src/pg/transaction/index.js";
import { openDatabase, seedOrganizationId } from "../support/database.js";

// One node, so nothing is ever placed: every repository here resolves to it.
const shards = new ShardScope();

let database: Database;
let scope: TransactionScope;
let platformOrganization: OrganizationId;
let admin: UserId;
let outsider: UserId;
let customer: OrganizationId;

const PLATFORM_KEYS = PermissionRegistry.instance.byScope("platform");

const memberOf = async (organizationId: OrganizationId, userId: UserId, roleKey: string) => {
  const [role] = await database.client
    .select({ id: roles.id })
    .from(roles)
    .where(and(eq(roles.organizationId, organizationId), eq(roles.key, roleKey)));
  if (!role) throw new Error(`no ${roleKey} role — run \`pnpm db:seed\``);

  await database.client
    .insert(memberships)
    .values({
      id: crypto.randomUUID(),
      organizationId,
      userId,
      roleId: role.id,
    })
    .onConflictDoNothing();
};

const userNamed = async (email: string): Promise<UserId> => {
  const id = crypto.randomUUID() as UserId;
  await database.client.insert(users).values({ id, name: email, email });
  return id;
};

beforeAll(async () => {
  database = openDatabase();
  scope = new TransactionScope();
  platformOrganization = await seedOrganizationId(database);

  // The seeds are idempotent and `pnpm db:seed` has already run them; running them here
  // means this spec passes against a database seeded before the tier existed too.
  await new SystemRoleSeed(DatabaseCluster.single(database), scope, shards).run(
    platformOrganization,
  );
  await new PlatformRoleSeed(DatabaseCluster.single(database), scope, shards).run();

  admin = await userNamed(`platform-admin-${crypto.randomUUID()}@test.local`);
  outsider = await userNamed(`tenant-owner-${crypto.randomUUID()}@test.local`);

  await memberOf(platformOrganization, admin, "platform_admin");
  await memberOf(platformOrganization, outsider, "owner");

  // A customer tenant the platform admin is an ordinary member of.
  customer = crypto.randomUUID() as OrganizationId;
  await database.client
    .insert(organizations)
    .values({ id: customer, slug: `customer-${customer}`, name: "Customer" });
  await new SystemRoleSeed(DatabaseCluster.single(database), scope, shards).run(customer);
  await memberOf(customer, admin, "member");
});

afterAll(async () => {
  for (const id of [admin, outsider]) {
    await database.client.delete(memberships).where(eq(memberships.userId, id));
    await database.client.delete(permissionOverrides).where(eq(permissionOverrides.userId, id));
    await database.client.delete(users).where(eq(users.id, id));
  }
  await database.client.delete(organizations).where(eq(organizations.id, customer));
  await database.close();
});

describe("PgPlatformReader", () => {
  it("resolves the one organization marked is_platform", async () => {
    const reader = new PgPlatformReader(DatabaseCluster.single(database), scope, shards);
    expect(await reader.organizationId()).toBe(platformOrganization);
  });

  // `organizations_platform_uq` is what makes `.limit(1)` a lookup rather than a coin
  // flip, and a partial index is the only shape that allows many false rows.
  it("refuses a second platform organization at the index", async () => {
    const id = crypto.randomUUID() as OrganizationId;

    // The constraint name rides `cause`, not `message`: drizzle wraps the driver error
    // in one naming the statement, and asserting on that would pass for any failure.
    const failure = await database.client
      .insert(organizations)
      .values({ id, slug: `second-tier-${id}`, name: "Second tier", isPlatform: true })
      .then(() => null)
      .catch((error: unknown) => error);

    expect(String((failure as { cause?: unknown })?.cause)).toContain("organizations_platform_uq");
  });
});

describe("PgCapabilityRepository.resolvePlatformFor", () => {
  it("holds every platform key through the seeded role", async () => {
    const resolved = await new PgCapabilityRepository(
      DatabaseCluster.single(database),
      scope,
      shards,
    ).resolvePlatformFor(admin);

    for (const key of PLATFORM_KEYS) expect(resolved.can(key), key).toBe(true);
    expect(PLATFORM_KEYS.length).toBeGreaterThan(0);
  });

  // The whole point of decision D31 from the database side: a tenant `owner` holds the
  // wildcard over every tenant key and is not a platform admin.
  it("holds nothing for a member of the tier under an ordinary role", async () => {
    const resolved = await new PgCapabilityRepository(
      DatabaseCluster.single(database),
      scope,
      shards,
    ).resolvePlatformFor(outsider);

    for (const key of PLATFORM_KEYS) expect(resolved.can(key), key).toBe(false);
  });

  // The axis is the platform one alone. A tenant key resolved here would be a grant the
  // merge in `PrincipalBuilder` silently widened.
  it("carries only the platform axis", async () => {
    const resolved = await new PgCapabilityRepository(
      DatabaseCluster.single(database),
      scope,
      shards,
    ).resolvePlatformFor(admin);

    expect(resolved.can("rbac.role.read")).toBe(false);
    expect(resolved.toJSON().org).toEqual({ grants: [], denies: [] });
    expect(resolved.toJSON().wildcard).toBe(false);
  });

  it("lets a per-user deny in the tier beat the role's grant", async () => {
    await database.client.insert(permissionOverrides).values({
      id: crypto.randomUUID(),
      organizationId: platformOrganization,
      userId: admin,
      permission: "platform.flag.manage",
      effect: "deny",
      goalId: null,
    });

    const resolved = await new PgCapabilityRepository(
      DatabaseCluster.single(database),
      scope,
      shards,
    ).resolvePlatformFor(admin);

    expect(resolved.can("platform.flag.manage")).toBe(false);
    expect(resolved.can("platform.status.read")).toBe(true);

    await database.client
      .delete(permissionOverrides)
      .where(
        and(
          eq(permissionOverrides.userId, admin),
          eq(permissionOverrides.permission, "platform.flag.manage"),
        ),
      );
  });

  // Live rows only, as the tenant axis reads them: a lapsed grant gives nothing.
  it("ignores a platform exception past its expiry", async () => {
    await database.client.insert(permissionOverrides).values({
      id: crypto.randomUUID(),
      organizationId: platformOrganization,
      userId: outsider,
      permission: "platform.flag.manage",
      effect: "grant",
      reason: "lapsed trial",
      goalId: null,
      expiresAt: new Date(Date.now() - 60_000),
    });

    const resolved = await new PgCapabilityRepository(
      DatabaseCluster.single(database),
      scope,
      shards,
    ).resolvePlatformFor(outsider);
    expect(resolved.can("platform.flag.manage")).toBe(false);

    await database.client
      .delete(permissionOverrides)
      .where(eq(permissionOverrides.userId, outsider));
  });

  // Removing someone's platform rights is deactivating their membership in the tier, so
  // this is the revocation path and not a detail of the query.
  it("holds nothing once the membership is deactivated", async () => {
    await database.client
      .update(memberships)
      .set({ deactivatedAt: new Date() })
      .where(
        and(eq(memberships.organizationId, platformOrganization), eq(memberships.userId, admin)),
      );

    const resolved = await new PgCapabilityRepository(
      DatabaseCluster.single(database),
      scope,
      shards,
    ).resolvePlatformFor(admin);
    expect(resolved.can("platform.status.read")).toBe(false);

    await database.client
      .update(memberships)
      .set({ deactivatedAt: null })
      .where(
        and(eq(memberships.organizationId, platformOrganization), eq(memberships.userId, admin)),
      );
  });
});

describe("SystemRoleSeed and PlatformRoleSeed", () => {
  // `owner: "all"` used to mean the whole catalog. It now means the catalog minus the
  // platform scope, and `reconcile()` takes back what an earlier deploy handed out.
  it("leaves no platform key on a tenant owner", async () => {
    const held = await database.client.execute<{ permission: string }>(sql`
      select rp.permission
      from role_permissions rp
      join roles r on r.id = rp.role_id
      where r.key = 'owner' and rp.permission like 'platform.%'
    `);

    expect(held.rows).toEqual([]);
  });

  // The tier is run like any organization, so its top role holds the tenant keys as well.
  it("grants the platform role every key in the catalog", async () => {
    const held = await database.client.execute<{ permission: string }>(sql`
      select rp.permission
      from role_permissions rp
      join roles r on r.id = rp.role_id
      where r.key = 'platform_admin'
      order by rp.permission
    `);

    expect(held.rows.map((row) => row.permission)).toEqual(
      [...PermissionRegistry.instance.all()].sort(),
    );
  });

  // Granting nothing, such a row only blocks the tenant's owner from assigning the role.
  it("takes platform keys back from roles in every other organization", async () => {
    const [role] = await database.client
      .select({ id: roles.id })
      .from(roles)
      .where(and(eq(roles.organizationId, customer), eq(roles.key, "guest")));
    if (!role) throw new Error("no guest role");
    await database.client.execute(sql`
      insert into role_permissions (organization_id, role_id, permission)
      values (${customer}, ${role.id}, 'platform.status.read')
    `);

    await new PlatformRoleSeed(DatabaseCluster.single(database), scope, shards).run();

    const left = await database.client.execute<{ permission: string }>(sql`
      select permission from role_permissions
      where organization_id = ${customer} and permission like 'platform.%'
    `);
    expect(left.rows).toEqual([]);
  });
});

describe("tenant keys on the platform role", () => {
  const capabilities = () =>
    new PgCapabilityRepository(DatabaseCluster.single(database), scope, shards);

  it("hold every tenant key while the platform organization is active", async () => {
    const held = await capabilities().resolveFor(platformOrganization, admin);
    for (const key of [
      "member.invite",
      "member.role.change",
      "rbac.role.manage",
      "doc.page.publish",
    ]) {
      expect(held.can(key as never), key).toBe(true);
    }
  });

  // "A platform admin is not a tenant owner": inside a customer tenant they hold only what
  // that tenant gave them.
  it("reach no customer tenant, where the admin holds only their role there", async () => {
    const held = await capabilities().resolveFor(customer, admin);
    for (const key of [
      "member.invite",
      "member.role.change",
      "rbac.role.manage",
      "doc.page.write",
    ]) {
      expect(held.can(key as never), key).toBe(false);
    }
    expect(held.can("doc.page.read")).toBe(true);
  });
});
