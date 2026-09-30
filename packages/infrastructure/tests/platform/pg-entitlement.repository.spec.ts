import { Identifiers, type OrganizationId } from "@loadbearing/contracts";
import { Uuid } from "@loadbearing/core";
import { eq, inArray } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { DatabaseCluster } from "../../src/pg/primitive/index.js";
import { PgEntitlementRepository } from "../../src/pg/repository/pg-entitlement.repository.js";
import { disabledModules, organizations, plans } from "../../src/pg/schema/index.js";
import { ShardScope, TransactionScope } from "../../src/pg/transaction/index.js";
import { openDatabase } from "../support/database.js";

const database = openDatabase();
const entitlements = new PgEntitlementRepository(
  DatabaseCluster.single(database),
  new TransactionScope(),
  new ShardScope(),
);

const actor = Identifiers.userId.parse(Uuid.v7());
// Per run, so an aborted run leaves a plan nothing else reads as real.
const PLAN = `spec-${Uuid.v7()}`;
const created: OrganizationId[] = [];

const tenant = async () => {
  const id = Identifiers.organizationId.parse(Uuid.v7());
  await database.client.insert(organizations).values({ id, slug: `ent-${id}`, name: "Ent" });
  created.push(id);
  return id;
};

afterAll(async () => {
  if (created.length > 0) {
    await database.client.delete(organizations).where(inArray(organizations.id, created));
  }
  await database.client.delete(plans).where(eq(plans.key, PLAN));
  await database.client.delete(disabledModules).where(eq(disabledModules.module, "doc"));
  await entitlements.saveDefaultPlan("unlimited");
  await database.close();
});

describe("PgEntitlementRepository — plans", () => {
  it("has the migration's unlimited plan, system and unlimited", async () => {
    expect(await entitlements.findPlan("unlimited")).toMatchObject({
      isUnlimited: true,
      isSystem: true,
      permissions: [],
    });
  });

  it("saves a plan with its keys, and a second save reconciles them", async () => {
    await entitlements.savePlan({
      key: PLAN,
      name: "Spec",
      description: "",
      permissions: ["member.read", "rbac.role.read"],
    });
    await entitlements.savePlan({
      key: PLAN,
      name: "Spec 2",
      description: "renamed",
      permissions: ["member.read"],
    });

    expect(await entitlements.findPlan(PLAN)).toMatchObject({
      name: "Spec 2",
      description: "renamed",
      permissions: ["member.read"],
      organizations: 0,
    });
  });

  it("counts the orgs on a plan, and moves one between plans", async () => {
    const organizationId = await tenant();
    expect(await entitlements.findPlanOf(organizationId)).toBe("unlimited");

    await entitlements.savePlanOf(organizationId, PLAN);

    expect(await entitlements.findPlanOf(organizationId)).toBe(PLAN);
    expect((await entitlements.findPlan(PLAN))?.organizations).toBe(1);
    expect((await entitlements.findPlans()).map((plan) => plan.key)).toContain(PLAN);
  });

  // The use-case refuses a plan in use first; this is what holds if something skips it.
  it("refuses to delete a plan an org is on", async () => {
    await expect(entitlements.deletePlan(PLAN)).rejects.toThrow();
  });

  it("reads and writes the default plan", async () => {
    await entitlements.saveDefaultPlan(PLAN);
    expect(await entitlements.findDefaultPlan()).toBe(PLAN);

    await entitlements.saveDefaultPlan("unlimited");
    expect(await entitlements.findDefaultPlan()).toBe("unlimited");
  });
});

describe("PgEntitlementRepository — adjustments", () => {
  it("upserts one row per key, so a second adjustment replaces the first", async () => {
    const organizationId = await tenant();

    await entitlements.saveAdjustments(
      organizationId,
      [
        { permission: "member.invite", effect: "add", reason: "trial", expiresAt: null },
        { permission: "member.read", effect: "add", reason: "trial", expiresAt: null },
      ],
      actor,
    );
    await entitlements.saveAdjustments(
      organizationId,
      [{ permission: "member.invite", effect: "remove", reason: "changed", expiresAt: null }],
      actor,
    );

    expect(
      (await entitlements.findAdjustments(organizationId)).map((row) => [
        row.permission,
        row.effect,
        row.reason,
      ]),
    ).toEqual([
      ["member.invite", "remove", "changed"],
      ["member.read", "add", "trial"],
    ]);
  });

  it("finds only what has expired, and says whether a delete removed anything", async () => {
    const organizationId = await tenant();
    const now = new Date();
    await entitlements.saveAdjustments(
      organizationId,
      [
        {
          permission: "analytics.activity.read",
          effect: "add",
          reason: "trial",
          expiresAt: new Date(now.getTime() - 1_000),
        },
        {
          permission: "member.read",
          effect: "add",
          reason: "trial",
          expiresAt: new Date(now.getTime() + 60_000),
        },
      ],
      actor,
    );

    const expired = (await entitlements.findExpired(now)).filter(
      (row) => row.organizationId === organizationId,
    );
    expect(expired.map((row) => row.permission)).toEqual(["analytics.activity.read"]);

    expect(await entitlements.deleteAdjustment(organizationId, "analytics.activity.read")).toBe(
      true,
    );
    expect(await entitlements.deleteAdjustment(organizationId, "analytics.activity.read")).toBe(
      false,
    );
  });
});

describe("PgEntitlementRepository — the kill switch", () => {
  it("switches a module off with a reason, and on again", async () => {
    await entitlements.saveDisabledModule("doc", "incident", actor);
    expect(
      (await entitlements.findDisabledModules()).find((row) => row.module === "doc")?.reason,
    ).toBe("incident");

    await entitlements.deleteDisabledModule("doc");
    expect((await entitlements.findDisabledModules()).some((row) => row.module === "doc")).toBe(
      false,
    );
  });
});
