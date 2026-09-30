import { Identifiers, type UserId } from "@loadbearing/contracts";
import { Uuid } from "@loadbearing/core";
import { eq, inArray } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { DatabaseCluster } from "../../src/pg/primitive/index.js";
import { PgPermissionOverrideRepository } from "../../src/pg/repository/pg-permission-override.repository.js";
import { permissionOverrides, users } from "../../src/pg/schema/index.js";
import { ShardScope, TransactionScope } from "../../src/pg/transaction/index.js";
import { openDatabase, seedOrganizationId } from "../support/database.js";

const database = openDatabase();
const overrides = new PgPermissionOverrideRepository(
  DatabaseCluster.single(database),
  new TransactionScope(),
  new ShardScope(),
);
const actor = Identifiers.userId.parse(Uuid.v7());
const created: UserId[] = [];

const makeUser = async () => {
  const id = Identifiers.userId.parse(Uuid.v7());
  await database.client
    .insert(users)
    .values({ id, name: "Ada", email: `${id}@example.test`, emailVerified: true });
  created.push(id);
  return id;
};

const inAnHour = () => new Date(Date.now() + 3_600_000);

afterAll(async () => {
  if (created.length > 0) {
    await database.client
      .delete(permissionOverrides)
      .where(inArray(permissionOverrides.userId, created));
    await database.client.delete(users).where(inArray(users.id, created));
  }
  await database.close();
});

describe("PgPermissionOverrideRepository", () => {
  it("replaces the org's deny with a grant of the same key, in one row", async () => {
    const organizationId = await seedOrganizationId(database);
    const userId = await makeUser();

    await overrides.save(
      organizationId,
      userId,
      [
        {
          permission: "member.read",
          effect: "deny",
          reason: null,
          expiresAt: null,
          authority: "org",
        },
      ],
      actor,
    );
    await overrides.save(
      organizationId,
      userId,
      [
        {
          permission: "member.read",
          effect: "grant",
          reason: "cover",
          expiresAt: inAnHour(),
          authority: "org",
        },
      ],
      actor,
    );

    const rows = await overrides.findFor(organizationId, userId);
    expect(rows.map((row) => [row.permission, row.effect, row.reason])).toEqual([
      ["member.read", "grant", "cover"],
    ]);
  });

  // Two owners, two rows: the org's own grant cannot overwrite the platform's deny.
  it("keeps a platform deny beside the org's row for the same key", async () => {
    const organizationId = await seedOrganizationId(database);
    const userId = await makeUser();
    const deny = { effect: "deny" as const, reason: null, expiresAt: null };

    await overrides.save(
      organizationId,
      userId,
      [{ permission: "member.read", ...deny, authority: "platform" }],
      actor,
    );
    await overrides.save(
      organizationId,
      userId,
      [{ permission: "member.read", ...deny, authority: "org" }],
      actor,
    );

    expect((await overrides.findFor(organizationId, userId)).map((row) => row.authority)).toEqual([
      "org",
      "platform",
    ]);
  });

  it("lists live rows only, and finds the expired ones for the sweep", async () => {
    const organizationId = await seedOrganizationId(database);
    const userId = await makeUser();
    await database.client.insert(permissionOverrides).values({
      id: Uuid.v7(),
      organizationId,
      userId,
      goalId: null,
      permission: "analytics.activity.read",
      effect: "grant",
      reason: "trial",
      expiresAt: new Date(Date.now() - 60_000),
    });

    expect(await overrides.findFor(organizationId, userId)).toEqual([]);
    const expired = (await overrides.findExpired(new Date())).filter(
      (row) => row.userId === userId,
    );
    expect(expired.map((row) => row.permission)).toEqual(["analytics.activity.read"]);

    await overrides.delete(organizationId, expired[0]?.id ?? "");
    expect(
      await database.client
        .select()
        .from(permissionOverrides)
        .where(eq(permissionOverrides.userId, userId)),
    ).toEqual([]);
  });

  it("finds a row by id only inside its own tenant", async () => {
    const organizationId = await seedOrganizationId(database);
    const userId = await makeUser();
    await overrides.save(
      organizationId,
      userId,
      [
        {
          permission: "member.read",
          effect: "deny",
          reason: null,
          expiresAt: null,
          authority: "org",
        },
      ],
      actor,
    );
    const [row] = await overrides.findFor(organizationId, userId);
    if (!row) throw new Error("the save above wrote one row");

    expect((await overrides.findById(organizationId, row.id))?.permission).toBe("member.read");
    expect(
      await overrides.findById(Identifiers.organizationId.parse(Uuid.v7()), row.id),
    ).toBeNull();
  });
});
