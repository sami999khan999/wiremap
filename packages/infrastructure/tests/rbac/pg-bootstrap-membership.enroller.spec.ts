import { Identifiers, type OrganizationId, type UserId } from "@loadbearing/contracts";
import { SystemClock, Uuid } from "@loadbearing/core";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "../../src/pg/primitive/index.js";
import { DatabaseCluster } from "../../src/pg/primitive/index.js";
import { PgActivityLogger } from "../../src/pg/repository/pg-activity.logger.js";
import { PgBootstrapMembershipEnroller } from "../../src/pg/repository/pg-bootstrap-membership.enroller.js";
import { PgOrganizationFounder } from "../../src/pg/repository/pg-organization.founder.js";
import { memberships, organizations, roles, users } from "../../src/pg/schema/index.js";
import { ShardScope, TransactionScope } from "../../src/pg/transaction/index.js";
import { openDatabase } from "../support/database.js";
import { RecordingLogger } from "../support/recording.logger.js";

// One node, so nothing is ever placed: every repository here resolves to it.
const shards = new ShardScope();

let database: Database;

// Two organizations are needed to say anything about tenant scoping, so this spec creates
// its own rather than reading the seeded one. All of it is torn down.
const users_: UserId[] = [];
const orgs: OrganizationId[] = [];

const makeUser = async () => {
  const id = Identifiers.userId.parse(Uuid.v7());
  await database.client
    .insert(users)
    .values({ id, name: "Ada", email: `${id}@example.test`, emailVerified: true });
  users_.push(id);
  return id;
};

const scoped = () => {
  const scope = new TransactionScope();
  const activity = new PgActivityLogger(
    DatabaseCluster.single(database),
    scope,
    shards,
    new SystemClock(),
  );
  return {
    scope,
    founder: new PgOrganizationFounder(
      DatabaseCluster.single(database),
      scope,
      shards,
      activity,
      new RecordingLogger(),
    ),
  };
};

// A tenant with the seeded role set, founded the same way a first sign-in founds one, so
// `owner` and `member` are both present and the enroller has something to bind to.
const makeOrganization = async (slug: string) => {
  const { founder } = scoped();
  const owner = await makeUser();
  const id = await founder.found(owner, "Bootstrap target", slug);
  orgs.push(id);
  return { id, slug };
};

beforeAll(() => {
  database = openDatabase();
});

afterAll(async () => {
  if (users_.length > 0) await database.client.delete(users).where(inArray(users.id, users_));

  for (const id of orgs) {
    await database.client.delete(memberships).where(eq(memberships.organizationId, id));
    await database.client.delete(roles).where(eq(roles.organizationId, id));
    await database.client.delete(organizations).where(eq(organizations.id, id));
  }

  await database.close();
});

const enrollerFor = (slug: string | undefined) => {
  const { scope } = scoped();
  return new PgBootstrapMembershipEnroller(DatabaseCluster.single(database), scope, shards, slug);
};

const membershipsOf = (userId: UserId) =>
  database.client
    .select({ organizationId: memberships.organizationId })
    .from(memberships)
    .where(eq(memberships.userId, userId));

describe("PgBootstrapMembershipEnroller", () => {
  it("enrols a brand-new user into the named organization", async () => {
    const target = await makeOrganization(`bootstrap-${Uuid.v7()}`);
    const userId = await makeUser();

    expect(await enrollerFor(target.slug).enrol(userId)).toBe(target.id);
    expect(await membershipsOf(userId)).toEqual([{ organizationId: target.id }]);
  });

  // The regression guard: with no tenant predicate, a user holding a membership anywhere
  // was handed *that* organization back.
  it("does not hand back an organization the user belongs to elsewhere", async () => {
    const other = await makeOrganization(`elsewhere-${Uuid.v7()}`);
    const target = await makeOrganization(`bootstrap-${Uuid.v7()}`);
    const userId = await makeUser();

    // A membership in some unrelated tenant, exactly as an invitation would leave.
    expect(await enrollerFor(other.slug).enrol(userId)).toBe(other.id);

    expect(await enrollerFor(target.slug).enrol(userId)).toBe(target.id);

    const held = (await membershipsOf(userId)).map((row) => row.organizationId).sort();
    expect(held).toEqual([other.id, target.id].sort());
  });

  it("is idempotent within the organization it was asked about", async () => {
    const target = await makeOrganization(`bootstrap-${Uuid.v7()}`);
    const userId = await makeUser();

    const first = await enrollerFor(target.slug).enrol(userId);
    const second = await enrollerFor(target.slug).enrol(userId);

    expect(second).toBe(first);
    expect(await membershipsOf(userId)).toHaveLength(1);
  });

  it("declines when no slug was configured", async () => {
    expect(await enrollerFor(undefined).enrol(await makeUser())).toBeNull();
  });

  it("declines when the slug names no organization", async () => {
    expect(await enrollerFor(`missing-${Uuid.v7()}`).enrol(await makeUser())).toBeNull();
  });
});
