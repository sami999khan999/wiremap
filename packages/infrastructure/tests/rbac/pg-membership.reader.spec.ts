import { Identifiers, type OrganizationId, type UserId } from "@loadbearing/contracts";
import { SystemClock, Uuid } from "@loadbearing/core";
import { and, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "../../src/pg/primitive/index.js";
import { DatabaseCluster } from "../../src/pg/primitive/index.js";
import { PgActivityLogger } from "../../src/pg/repository/pg-activity.logger.js";
import { PgMembershipReader } from "../../src/pg/repository/pg-membership.reader.js";
import { PgOrganizationFounder } from "../../src/pg/repository/pg-organization.founder.js";
import { memberships, organizations, roles, users } from "../../src/pg/schema/index.js";
import { ShardScope, TransactionScope } from "../../src/pg/transaction/index.js";
import { openDatabase } from "../support/database.js";
import { RecordingLogger } from "../support/recording.logger.js";

// One node, so nothing is ever placed: every repository here resolves to it.
const shards = new ShardScope();

let database: Database;
const created: UserId[] = [];
const founded: OrganizationId[] = [];

// One person in two organizations, and a stranger in a third.
let ada: UserId;
let grace: UserId;
let first: OrganizationId;
let second: OrganizationId;
let elsewhere: OrganizationId;

const makeUser = async (name: string) => {
  const id = Identifiers.userId.parse(Uuid.v7());
  await database.client
    .insert(users)
    .values({ id, name, email: `${id}@example.test`, emailVerified: true });
  created.push(id);
  return id;
};

const found = async (userId: UserId, name: string) => {
  const scope = new TransactionScope();
  const founder = new PgOrganizationFounder(
    DatabaseCluster.single(database),
    scope,
    shards,
    new PgActivityLogger(DatabaseCluster.single(database), scope, shards, new SystemClock()),
    new RecordingLogger(),
  );
  const id = await founder.found(userId, name);
  founded.push(id);
  return id;
};

const setLastActive = (userId: UserId, organizationId: OrganizationId | null) =>
  database.client
    .update(users)
    .set({ lastActiveOrganizationId: organizationId })
    .where(eq(users.id, userId));

const reader = () =>
  new PgMembershipReader(DatabaseCluster.single(database), new TransactionScope(), shards);

// Joins a user to an existing tenant at a named system role, which `found` cannot do —
// its founder is always the owner.
const joinAs = async (userId: UserId, organizationId: OrganizationId, key: string) => {
  const [role] = await database.client
    .select({ id: roles.id })
    .from(roles)
    .where(and(eq(roles.organizationId, organizationId), eq(roles.key, key)))
    .limit(1);

  await database.client.insert(memberships).values({
    id: Uuid.v7(),
    organizationId,
    userId,
    roleId: role?.id ?? "",
  });
};

beforeAll(async () => {
  database = openDatabase();
  ada = await makeUser("Ada");
  grace = await makeUser("Grace");
  first = await found(ada, "First");
  second = await found(ada, "Second");
  elsewhere = await found(grace, "Elsewhere");
  // Grace owns her own and is a plain member of Ada's first. Ada is left alone: three
  // other specs assert exactly which tenants she is and is not in.
  await joinAs(grace, first, "member");
});

afterAll(async () => {
  await database.client.delete(memberships).where(inArray(memberships.userId, created));
  await database.client.delete(users).where(inArray(users.id, created));
  for (const organizationId of founded) {
    await database.client.delete(roles).where(eq(roles.organizationId, organizationId));
    await database.client.delete(organizations).where(eq(organizations.id, organizationId));
  }
  await database.close();
});

describe("PgMembershipReader", () => {
  it("lists a user's organizations oldest first", async () => {
    const rows = await reader().organizationsFor(ada);

    expect(rows.map((row) => row.id)).toEqual([first, second]);
    expect(rows[0]).toEqual({ id: first, name: "First", slug: `o-${first}`, roleName: "Owner" });
  });

  // Why `roleName` is on the row and not on the user: a join on the wrong column would
  // read "Owner" for every tenant without failing anything else.
  it("names the role this user holds in each organization, not one role for the user", async () => {
    const rows = await reader().organizationsFor(grace);

    expect(rows.map((row) => row.name)).toEqual(["Elsewhere", "First"]);
    expect(rows.map((row) => row.roleName)).toEqual(["Owner", "Member"]);
  });

  it("answers membership for the switch endpoint", async () => {
    expect(await reader().isActive(ada, first)).toBe(true);
    expect(await reader().isActive(ada, elsewhere)).toBe(false);
    expect(await reader().isActive(grace, elsewhere)).toBe(true);
    expect(await reader().isSuspended(grace)).toBe(false);
  });

  // `CR.7`. Pinned to the tenant that deactivated them, every request answered anonymous
  // and the user never reached the switcher to leave it.
  it("passes over a deactivated membership for sign-in, the switcher and the switch", async () => {
    const deactivate = (at: Date | null) =>
      database.client
        .update(memberships)
        .set({ deactivatedAt: at })
        .where(and(eq(memberships.userId, grace), eq(memberships.organizationId, elsewhere)));
    await setLastActive(grace, elsewhere);
    await deactivate(new Date());

    try {
      expect(await reader().activeOrganizationFor(grace)).toBe(first);
      expect((await reader().organizationsFor(grace)).map((row) => row.id)).toEqual([first]);
      expect(await reader().isActive(grace, elsewhere)).toBe(false);
    } finally {
      await deactivate(null);
      await setLastActive(grace, null);
    }
  });

  // `AX6.2`. The suspend is on the user, so every membership they hold goes dark at once.
  it("answers a suspended account as a member of nothing, in every tenant", async () => {
    const suspend = (at: Date | null) =>
      database.client.update(users).set({ suspendedAt: at }).where(eq(users.id, grace));
    await suspend(new Date());

    try {
      expect(await reader().isSuspended(grace)).toBe(true);
      expect(await reader().isSuspended(ada)).toBe(false);
      expect(await reader().activeOrganizationFor(grace)).toBeNull();
      expect(await reader().organizationsFor(grace)).toEqual([]);
      expect(await reader().isActive(grace, elsewhere)).toBe(false);
      expect(await reader().isActiveMember(first, grace)).toBe(false);
      expect([...(await reader().activeMemberIds(first, [ada, grace]))]).toEqual([ada]);
    } finally {
      await suspend(null);
    }

    expect(await reader().isActive(grace, elsewhere)).toBe(true);
  });

  it("defaults the active organization to the oldest membership", async () => {
    await setLastActive(ada, null);

    expect(await reader().activeOrganizationFor(ada)).toBe(first);
  });

  it("prefers the last active organization while the user is still a member of it", async () => {
    await setLastActive(ada, second);

    expect(await reader().activeOrganizationFor(ada)).toBe(second);
  });

  // A stale preference — a tenant they were removed from, or never in — must not put
  // a session into an organization the user holds no membership in.
  it("falls back to the oldest membership when the preference is not one of theirs", async () => {
    await setLastActive(ada, elsewhere);

    expect(await reader().activeOrganizationFor(ada)).toBe(first);
  });

  it("returns null for a user with no membership at all", async () => {
    const nobody = await makeUser("Nobody");

    expect(await reader().activeOrganizationFor(nobody)).toBeNull();
    expect(await reader().organizationsFor(nobody)).toEqual([]);
  });

  // What bounds `/organization/create`. Grace is the case that matters: two memberships,
  // one of them as a plain member, so a count of memberships would give the wrong answer.
  it("counts the organizations a user owns, not the ones they belong to", async () => {
    expect(await reader().ownedCount(ada)).toBe(2);
    expect(await reader().ownedCount(grace)).toBe(1);
  });

  it("counts zero for a user who owns nothing", async () => {
    const nobody = await makeUser("Nobody Else");

    expect(await reader().ownedCount(nobody)).toBe(0);
  });
});
