import { Identifiers, type OrganizationId, type UserId } from "@loadbearing/contracts";
import { SystemClock, Uuid } from "@loadbearing/core";
import { and, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "../../src/pg/primitive/index.js";
import { DatabaseCluster } from "../../src/pg/primitive/index.js";
import { PgActivityLogger } from "../../src/pg/repository/pg-activity.logger.js";
import { PgOrganizationFounder } from "../../src/pg/repository/pg-organization.founder.js";
import { PgUserReader } from "../../src/pg/repository/pg-user.reader.js";
import { memberships, organizations, roles, users } from "../../src/pg/schema/index.js";
import { ShardScope, TransactionScope } from "../../src/pg/transaction/index.js";
import { openDatabase } from "../support/database.js";
import { RecordingLogger } from "../support/recording.logger.js";

const shards = new ShardScope();

let database: Database;
const created: UserId[] = [];
const founded: OrganizationId[] = [];

let ada: UserId;
let grace: UserId;
let stranger: UserId;
let mine: OrganizationId;
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

const joinAs = async (
  userId: UserId,
  organizationId: OrganizationId,
  key: string,
  deactivated = false,
) => {
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
    deactivatedAt: deactivated ? new Date() : null,
  });
};

const reader = () =>
  new PgUserReader(DatabaseCluster.single(database), new TransactionScope(), shards);

beforeAll(async () => {
  database = openDatabase();
  ada = await makeUser("Ada Lovelace");
  grace = await makeUser("Grace Hopper");
  stranger = await makeUser("Margaret Hamilton");
  mine = await found(ada, "Mine");
  elsewhere = await found(stranger, "Elsewhere");
  // Deactivated on purpose: she still wrote the messages above, so she still has a name.
  await joinAs(grace, mine, "member", true);
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

describe("PgUserReader", () => {
  it("names the members of the tenant it is asked about", async () => {
    const names = await reader().namesOf(mine, [ada, grace]);

    expect(names.get(ada)).toBe("Ada Lovelace");
    expect(names.get(grace)).toBe("Grace Hopper");
  });

  // `R.17`'s rule one layer up: `conversation_members.user_id` is only constrained to
  // `users.id`, which every tenant's people share. The scope is the join, not the id.
  it("names nobody from another tenant, even given their real id", async () => {
    const names = await reader().namesOf(mine, [stranger]);

    expect(names.size).toBe(0);
  });

  // Filtering the deactivated out is how a thread goes back to rendering uuids the day
  // somebody leaves, which is the defect this port exists to remove.
  it("still names a deactivated member", async () => {
    const names = await reader().namesOf(mine, [grace]);

    expect(names.get(grace)).toBe("Grace Hopper");
  });

  it("answers an empty request without a statement", async () => {
    expect((await reader().namesOf(mine, [])).size).toBe(0);
  });

  // The map is keyed, never zipped: a caller that paired two arrays by index would hand
  // one member another's name the moment a row is missing.
  it("returns only the ids it could resolve", async () => {
    const names = await reader().namesOf(mine, [ada, stranger]);

    expect([...names.keys()]).toEqual([ada]);
  });

  it("names the same person differently in a tenant they do not belong to", async () => {
    expect((await reader().namesOf(elsewhere, [ada])).size).toBe(0);
    expect((await reader().namesOf(elsewhere, [stranger])).get(stranger)).toBe("Margaret Hamilton");
  });
});
