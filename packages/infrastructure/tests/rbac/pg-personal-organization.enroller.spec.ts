import { Identifiers, type UserId } from "@loadbearing/contracts";
import { SystemClock, Uuid } from "@loadbearing/core";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "../../src/pg/primitive/index.js";
import { DatabaseCluster } from "../../src/pg/primitive/index.js";
import { PgActivityLogger } from "../../src/pg/repository/pg-activity.logger.js";
import { PgOrganizationFounder } from "../../src/pg/repository/pg-organization.founder.js";
import { PgPersonalOrganizationEnroller } from "../../src/pg/repository/pg-personal-organization.enroller.js";
import { memberships, organizations, roles, users } from "../../src/pg/schema/index.js";
import { ShardScope, TransactionScope } from "../../src/pg/transaction/index.js";
import { openDatabase } from "../support/database.js";
import { RecordingLogger } from "../support/recording.logger.js";

// One node, so nothing is ever placed: every repository here resolves to it.
const shards = new ShardScope();

let database: Database;

// This spec must create rows: the behaviour under test is what happens to a user with no
// membership, and the seeded organization has one. All of it is torn down.
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

beforeAll(() => {
  database = openDatabase();
});

afterAll(async () => {
  // Ordering matters only for the organizations, which are found through the memberships
  // that are about to be deleted.
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

describe("PgPersonalOrganizationEnroller", () => {
  // One scope shared by the enroller and the founder it delegates to — the founder's
  // savepoint has to open inside the enroller's locked transaction, not on the pool.
  const enroller = () => {
    const scope = new TransactionScope();
    const activity = new PgActivityLogger(
      DatabaseCluster.single(database),
      scope,
      shards,
      new SystemClock(),
    );
    return new PgPersonalOrganizationEnroller(
      DatabaseCluster.single(database),
      scope,
      shards,
      new PgOrganizationFounder(
        DatabaseCluster.single(database),
        scope,
        shards,
        activity,
        new RecordingLogger(),
      ),
    );
  };

  // The whole `personal` mode in one assertion: an account with nothing behind it ends
  // up owning a tenant with the same four system roles `pnpm db:seed` would have made.
  it("gives a new user an organization of their own, as its owner", async () => {
    const userId = await makeUser();

    const organizationId = await enroller().enrol(userId);
    expect(organizationId).not.toBeNull();

    const [membership] = await database.client
      .select({ roleId: memberships.roleId })
      .from(memberships)
      .where(eq(memberships.userId, userId));

    const [role] = await database.client
      .select({ key: roles.key })
      .from(roles)
      .where(eq(roles.id, membership?.roleId ?? ""));

    expect(role?.key).toBe("owner");
  });

  // What proves `SystemRoleSeed` is reused: a tenant created at sign-in must be
  // indistinguishable from a seeded one, or the second has a different permission model.
  it("seeds every system role into the organization it creates", async () => {
    const userId = await makeUser();
    const organizationId = await enroller().enrol(userId);

    const seeded = await database.client
      .select({ key: roles.key })
      .from(roles)
      .where(eq(roles.organizationId, organizationId ?? ""));

    expect(seeded.map((role) => role.key).sort()).toEqual(["admin", "guest", "member", "owner"]);
  });

  // The idempotency the advisory lock exists for: Better Auth retries a failed session
  // create, and a second organization per retry is a tenant nobody can reach.
  it("returns the same organization on a second call rather than making another", async () => {
    const userId = await makeUser();

    const first = await enroller().enrol(userId);
    const second = await enroller().enrol(userId);

    expect(second).toBe(first);

    const rows = await database.client
      .select({ id: memberships.id })
      .from(memberships)
      .where(eq(memberships.userId, userId));

    expect(rows).toHaveLength(1);
  });

  // Two sign-ins racing on one new user. Losing means two organizations for one person,
  // and `owner` is the wildcard role.
  it("serialises concurrent enrolments into exactly one organization", async () => {
    const userId = await makeUser();

    const results = await Promise.all([
      enroller().enrol(userId),
      enroller().enrol(userId),
      enroller().enrol(userId),
    ]);

    expect(new Set(results).size).toBe(1);

    const rows = await database.client
      .select({ id: memberships.id })
      .from(memberships)
      .where(eq(memberships.userId, userId));

    expect(rows).toHaveLength(1);
  });

  // The tenant is named after the person, so this package writes no English and needs
  // no locale to name an organization.
  it("names the organization after the user", async () => {
    const userId = await makeUser("Grace Hopper");
    const organizationId = await enroller().enrol(userId);
    if (organizationId === null) throw new Error("enrol created no organization");

    const [organization] = await database.client
      .select({ name: organizations.name, slug: organizations.slug })
      .from(organizations)
      .where(eq(organizations.id, organizationId));

    expect(organization?.name).toBe("Grace Hopper");
    // From the id, not the name: `organizations_slug_uq` would turn the second
    // "Grace Hopper" into a failed sign-in.
    expect(organization?.slug).toBe(`u-${userId}`);
  });

  // Declining beats throwing: the caller turns null into a refused session, which is the
  // safe failure for a row the session hook cannot actually reach.
  it("declines rather than inventing a tenant for a user that does not exist", async () => {
    const absent = Identifiers.userId.parse(Uuid.v7());

    expect(await enroller().enrol(absent)).toBeNull();
  });
});
