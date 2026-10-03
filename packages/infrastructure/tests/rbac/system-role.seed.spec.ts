import { Identifiers } from "@loadbearing/contracts";
import { Uuid } from "@loadbearing/core";
import { PermissionRegistry } from "@loadbearing/permissions";
import { and, eq, type Logger } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "../../src/pg/primitive/index.js";
import { DatabaseCluster } from "../../src/pg/primitive/index.js";
import { organizations, rolePermissions, roles } from "../../src/pg/schema/index.js";
import { SystemRoleSeed } from "../../src/pg/seed/index.js";
import { ShardScope, TransactionScope } from "../../src/pg/transaction/index.js";
import { openDatabase } from "../support/database.js";

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
let seed: SystemRoleSeed;
let organizationId: ReturnType<typeof Identifiers.organizationId.parse>;

beforeAll(async () => {
  database = openDatabase(counter);
  seed = new SystemRoleSeed(DatabaseCluster.single(database), new TransactionScope(), shards);

  // Its own tenant, never the seeded one: this spec counts statements, and a tenant
  // another spec is also seeding would make the count depend on the run order.
  organizationId = Identifiers.organizationId.parse(Uuid.v7());
  await database.client
    .insert(organizations)
    .values({ id: organizationId, name: "Seed Spec", slug: `seed-spec-${organizationId}` });
});

afterAll(async () => {
  await database.client.delete(organizations).where(eq(organizations.id, organizationId));
  await database.close();
});

beforeEach(() => {
  counter.count = 0;
});

const roleRows = () =>
  database.client
    .select({ id: roles.id, key: roles.key })
    .from(roles)
    .where(eq(roles.organizationId, organizationId));

describe("SystemRoleSeed.run", () => {
  it("seeds the four roles in four statements, not one per role", async () => {
    await seed.run(organizationId);

    // The regression: a SELECT and an INSERT per role plus a grants INSERT per role, so
    // eleven round trips. Four now, and not five when a fifth role is added.
    expect(counter.count).toBe(4);

    const rows = await roleRows();
    expect(rows.map((row) => row.key).sort()).toEqual([
      "admin",
      "guest",
      "member",
      "owner",
      "viewer",
    ]);
  });

  it("is idempotent, and costs the same four statements the second time", async () => {
    const before = await roleRows();
    counter.count = 0;

    await seed.run(organizationId);

    expect(counter.count).toBe(4);

    // Same ids: a re-seed must not replace the rows memberships point at.
    const after = await roleRows();
    expect(after.map((row) => row.id).sort()).toEqual(before.map((row) => row.id).sort());
  });

  // Every permission **but the platform scope**: a tenant owner is not a platform
  // admin, and `reconcile()` removes any platform key an earlier deploy's `all` gave.
  it("grants the owner every tenant permission the registry defines, and no platform key", async () => {
    const [owner] = await database.client
      .select({ id: roles.id })
      .from(roles)
      .where(and(eq(roles.organizationId, organizationId), eq(roles.key, "owner")));

    const granted = await database.client
      .select({ permission: rolePermissions.permission })
      .from(rolePermissions)
      .where(
        and(
          eq(rolePermissions.organizationId, organizationId),
          eq(rolePermissions.roleId, owner?.id ?? ""),
        ),
      );

    const tenantKeys = PermissionRegistry.instance
      .all()
      .filter((key) => PermissionRegistry.instance.scopeOf(key) !== "platform");

    expect(granted.map((row) => row.permission).sort()).toEqual([...tenantKeys].sort());
    expect(granted.some((row) => row.permission.startsWith("platform."))).toBe(false);
  });

  it("grants the guest nothing at all", async () => {
    const [guest] = await database.client
      .select({ id: roles.id })
      .from(roles)
      .where(and(eq(roles.organizationId, organizationId), eq(roles.key, "guest")));

    const granted = await database.client
      .select({ permission: rolePermissions.permission })
      .from(rolePermissions)
      .where(
        and(
          eq(rolePermissions.organizationId, organizationId),
          eq(rolePermissions.roleId, guest?.id ?? ""),
        ),
      );

    expect(granted).toHaveLength(0);
  });

  // The half an insert cannot do. Before this the seed only ever added, so a permission
  // dropped from a role's list — or removed from the catalog — stayed granted forever.
  it("takes back a grant that is no longer in the role's list", async () => {
    const [member] = await database.client
      .select({ id: roles.id })
      .from(roles)
      .where(and(eq(roles.organizationId, organizationId), eq(roles.key, "member")));

    if (!member) throw new Error("the seed did not create a member role");
    const grantedTo = async () =>
      (
        await database.client
          .select({ permission: rolePermissions.permission })
          .from(rolePermissions)
          .where(
            and(
              eq(rolePermissions.organizationId, organizationId),
              eq(rolePermissions.roleId, member.id),
            ),
          )
      )
        .map((row) => row.permission)
        .sort();

    // Read rather than written down: `member`'s list grows with every slice that adds an
    // inbox or a conversation, and a literal here is a spec that fails on the next one.
    const intended = await grantedTo();
    const stale = PermissionRegistry.instance
      .all()
      .find((key) => !intended.includes(key) && !key.startsWith("core."));
    if (!stale) throw new Error("the permission catalog is too small for this spec");

    await database.client
      .insert(rolePermissions)
      .values({ organizationId, roleId: member.id, permission: stale });

    await seed.run(organizationId);

    expect(await grantedTo()).toEqual(intended);
  });

  // `guest` is the case a per-role delete gets wrong: its intended set is empty, so it
  // contributes no pair to the `not in` and every stale row it holds has to go.
  it("empties a role whose list is empty", async () => {
    const [guest] = await database.client
      .select({ id: roles.id })
      .from(roles)
      .where(and(eq(roles.organizationId, organizationId), eq(roles.key, "guest")));

    const any = PermissionRegistry.instance.all()[0];
    if (!any || !guest) throw new Error("the permission catalog is empty");

    await database.client
      .insert(rolePermissions)
      .values({ organizationId, roleId: guest.id, permission: any });

    await seed.run(organizationId);

    const granted = await database.client
      .select({ permission: rolePermissions.permission })
      .from(rolePermissions)
      .where(
        and(
          eq(rolePermissions.organizationId, organizationId),
          eq(rolePermissions.roleId, guest.id),
        ),
      );

    expect(granted).toHaveLength(0);
  });
});
