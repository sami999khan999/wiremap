import { Identifiers, type OrganizationId, type UserId } from "@loadbearing/contracts";
import { Uuid } from "@loadbearing/core";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "../../src/pg/primitive/index.js";
import {
  apiKeys,
  documentChunks,
  entitlementAdjustments,
  featureFlagOrganizations,
  featureFlags,
  goalMembers,
  invitations,
  memberships,
  organizations,
  permissionOverrides,
  rolePermissions,
  roles,
  users,
} from "../../src/pg/schema/index.js";
import { openDatabase, seedTenant as seedTenantPartitions } from "../support/database.js";

let database: Database;
let userId: UserId;
let organizationId: OrganizationId;

// One flag row for the whole file, removed once: each seed targets it for a new tenant.
const CASCADE_FLAG = "cascade.spec";

const EMBEDDING = Array.from({ length: 1536 }, (_, i) => (i === 0 ? 1 : 0));

// Every tenant-owned table, written once so the delete below has something to leave
// behind if a foreign key is still `no action`.
const seedTenant = async () => {
  const roleId = Uuid.v7();
  organizationId = Identifiers.organizationId.parse(Uuid.v7());

  await database.client
    .insert(organizations)
    .values({ id: organizationId, slug: `cascade-${organizationId}`, name: "Cascade" });
  // `document_chunks` below is partitioned by tenant, so the partition comes first.
  await seedTenantPartitions(database, organizationId);
  await database.client
    .insert(roles)
    .values({ id: roleId, organizationId, key: "owner", name: "Owner", scope: "org" });
  await database.client
    .insert(rolePermissions)
    .values({ organizationId, roleId, permission: "task.reactivate" });
  await database.client
    .insert(memberships)
    .values({ id: Uuid.v7(), organizationId, userId, roleId });
  await database.client
    .insert(goalMembers)
    .values({ id: Uuid.v7(), organizationId, goalId: Uuid.v7(), userId, roleId });
  await database.client.insert(permissionOverrides).values({
    id: Uuid.v7(),
    organizationId,
    userId,
    permission: "task.reactivate",
    effect: "deny",
  });
  await database.client.insert(invitations).values({
    id: Uuid.v7(),
    organizationId,
    email: `invitee-${organizationId}@example.test`,
    roleId,
    tokenHash: `hash-${organizationId}`,
    invitedBy: userId,
    expiresAt: new Date(Date.now() + 86_400_000),
  });
  await database.client.insert(apiKeys).values({
    id: Uuid.v7(),
    organizationId,
    name: "key",
    issuerId: userId,
    prefix: organizationId.slice(0, 8),
    tokenHash: `key-${organizationId}`,
  });
  await database.client.insert(featureFlags).values({ key: CASCADE_FLAG }).onConflictDoNothing();
  await database.client
    .insert(featureFlagOrganizations)
    .values({ organizationId, flagKey: CASCADE_FLAG });
  await database.client.insert(entitlementAdjustments).values({
    id: Uuid.v7(),
    organizationId,
    permission: "member.read",
    effect: "remove",
    reason: "cascade",
  });
  await database.client.insert(documentChunks).values({
    id: Uuid.v7(),
    organizationId: Identifiers.organizationId.parse(organizationId),
    sourceId: Uuid.v7(),
    sourceType: "note",
    goalId: null,
    chunkIndex: 0,
    content: "a chunk",
    embedding: EMBEDDING,
  });

  await database.client
    .update(users)
    .set({ lastActiveOrganizationId: organizationId })
    .where(eq(users.id, userId));
};

const remaining = async () => {
  const counts = await Promise.all([
    database.client.select().from(roles).where(eq(roles.organizationId, organizationId)),
    database.client
      .select()
      .from(rolePermissions)
      .where(eq(rolePermissions.organizationId, organizationId)),
    database.client
      .select()
      .from(memberships)
      .where(eq(memberships.organizationId, organizationId)),
    database.client
      .select()
      .from(goalMembers)
      .where(eq(goalMembers.organizationId, organizationId)),
    database.client
      .select()
      .from(permissionOverrides)
      .where(eq(permissionOverrides.organizationId, organizationId)),
    database.client
      .select()
      .from(invitations)
      .where(eq(invitations.organizationId, organizationId)),
    database.client.select().from(apiKeys).where(eq(apiKeys.organizationId, organizationId)),
    database.client
      .select()
      .from(featureFlagOrganizations)
      .where(eq(featureFlagOrganizations.organizationId, organizationId)),
    database.client
      .select()
      .from(entitlementAdjustments)
      .where(eq(entitlementAdjustments.organizationId, organizationId)),
  ]);

  return counts.map((rows) => rows.length);
};

// Routed, and counted apart since `24.1`: it is on a shard, the tenant row is on the
// catalog, and no foreign key crosses between them any more.
const remainingChunks = async (): Promise<number> => {
  const rows = await database.client
    .select()
    .from(documentChunks)
    .where(eq(documentChunks.organizationId, Identifiers.organizationId.parse(organizationId)));

  return rows.length;
};

beforeAll(async () => {
  database = openDatabase();
  userId = Identifiers.userId.parse(Uuid.v7());
  await database.client
    .insert(users)
    .values({ id: userId, name: "Ada", email: `${userId}@example.test`, emailVerified: true });
});

afterAll(async () => {
  await database.client.delete(organizations).where(eq(organizations.id, organizationId));
  await database.client.delete(featureFlags).where(eq(featureFlags.key, CASCADE_FLAG));
  await database.client.delete(users).where(eq(users.id, userId));
  await database.close();
});

describe("deleting an organization", () => {
  // The regression guard: five tenant foreign keys were `no action` while three
  // cascaded, so this delete failed and a tenant could not be removed at all.
  it("takes every catalog row with it", async () => {
    await seedTenant();
    expect(await remaining()).toEqual([1, 1, 1, 1, 1, 1, 1, 1, 1]);

    await database.client.delete(organizations).where(eq(organizations.id, organizationId));

    expect(await remaining()).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0]);
  });

  // **And leaves the routed rows, which is `24.1` working rather than a leak.** A shard
  // is a different database, so nothing here can reach across to delete them.
  // ──
  // `PurgeOrganizationUseCase` drops the tenant's partition instead, and the nightly
  // orphan pass counts whatever that missed.
  it("leaves a routed table's rows, because no key crosses to the catalog", async () => {
    await seedTenant();
    expect(await remainingChunks()).toBe(1);

    await database.client.delete(organizations).where(eq(organizations.id, organizationId));

    expect(await remainingChunks()).toBe(1);

    await database.client
      .delete(documentChunks)
      .where(eq(documentChunks.organizationId, Identifiers.organizationId.parse(organizationId)));
  });

  // `users.last_active_organization_id` has been `set null` since 0004 — for a delete
  // that could not happen.
  it("leaves the user, with no organization to return to", async () => {
    const [user] = await database.client.select().from(users).where(eq(users.id, userId));

    expect(user?.lastActiveOrganizationId).toBeNull();
  });
});
