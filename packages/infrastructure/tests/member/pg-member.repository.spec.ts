import { Identifiers, type OrganizationId, type UserId } from "@loadbearing/contracts";
import { SystemClock, Uuid } from "@loadbearing/core";
import type { Logger } from "drizzle-orm";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "../../src/pg/primitive/index.js";
import { DatabaseCluster } from "../../src/pg/primitive/index.js";
import { PgActivityLogger } from "../../src/pg/repository/pg-activity.logger.js";
import { PgMemberRepository } from "../../src/pg/repository/pg-member.repository.js";
import { PgOrganizationFounder } from "../../src/pg/repository/pg-organization.founder.js";
import { PgRoleRepository } from "../../src/pg/repository/pg-role.repository.js";
import { organizations, permissionOverrides, roles, users } from "../../src/pg/schema/index.js";
import { ShardScope, TransactionScope } from "../../src/pg/transaction/index.js";
import { openDatabase } from "../support/database.js";
import { RecordingLogger } from "../support/recording.logger.js";

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
const created: UserId[] = [];
const founded: OrganizationId[] = [];

let ada: UserId;
let grace: UserId;
let acme: OrganizationId;
let other: OrganizationId;

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

const repository = () =>
  new PgMemberRepository(DatabaseCluster.single(database), new TransactionScope(), shards);

beforeAll(async () => {
  database = openDatabase(counter);
  ada = await makeUser("Ada");
  grace = await makeUser("Grace");
  acme = await found(ada, "Acme");
  other = await found(grace, "Other");
});

afterAll(async () => {
  await database.client.delete(users).where(inArray(users.id, created));
  for (const organizationId of founded) {
    await database.client.delete(roles).where(eq(roles.organizationId, organizationId));
    await database.client.delete(organizations).where(eq(organizations.id, organizationId));
  }
  await database.close();
});

describe("PgMemberRepository", () => {
  it("lists a tenant's members with their role, and only that tenant's", async () => {
    const page = await repository().list(acme, { limit: 25, offset: 0 });

    expect(page.total).toBe(1);
    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({
      userId: ada,
      name: "Ada",
      email: `${ada}@example.test`,
      roleKey: "owner",
      roleName: "Owner",
      deactivated: false,
      exceptions: 0,
    });
    expect(page.items[0]?.joinedAt).toBeInstanceOf(Date);

    const elsewhere = await repository().list(other, { limit: 25, offset: 0 });
    expect(elsewhere.items.map((m) => m.userId)).toEqual([grace]);
  });

  // "Two queries" decays silently — someone adds a lookup inside the map and it becomes
  // 2 + N, invisible at one member and the whole request at four hundred.
  it("lists in exactly two queries", async () => {
    counter.count = 0;

    await repository().list(acme, { limit: 25, offset: 0 });

    expect(counter.count).toBe(2);
  });

  // The platform's lock is on the account, so it shows in every tenant's list at once, and
  // it rides the `users` join the list already makes rather than a third query.
  it("reads the platform's suspend on the member, in the list and the single read", async () => {
    const suspend = (at: Date | null) =>
      database.client.update(users).set({ suspendedAt: at }).where(eq(users.id, grace));
    await suspend(new Date());

    try {
      const listed = await repository().list(other, { limit: 25, offset: 0 });
      expect(listed.items.find((m) => m.userId === grace)?.suspended).toBe(true);
      expect((await repository().findByUser(other, grace))?.suspended).toBe(true);
      expect((await repository().findByUser(acme, ada))?.suspended).toBe(false);
    } finally {
      await suspend(null);
    }
  });

  it("answers membership by address, case-insensitively and per tenant", async () => {
    const email = `${ada}@example.test`;

    expect(await repository().existsByEmail(acme, email.toUpperCase())).toBe(true);
    expect(await repository().existsByEmail(other, email)).toBe(false);
    expect(await repository().existsByEmail(acme, "nobody@example.test")).toBe(false);
  });
});

// `AX5.7`. The drift overlay: live exceptions counted in the statements that already
// run, so a role review sees them without opening anyone.
describe("PgMemberRepository and PgRoleRepository — exceptions", () => {
  const row = (permission: string, effect: "grant" | "deny", expiresAt: Date | null) => ({
    id: Uuid.v7(),
    organizationId: acme,
    userId: ada,
    goalId: null,
    permission,
    effect,
    reason: effect === "grant" ? "spec" : null,
    expiresAt,
  });

  it("counts live overrides only, on the member and on the role", async () => {
    await database.client.insert(permissionOverrides).values([
      row("apikey.read", "grant", new Date(Date.now() + 3_600_000)),
      row("member.invite", "deny", null),
      // A minute, not a second: `now()` is the database's clock, and Docker's VM drifts
      // a second behind the host after a sleep, which made a one-second lapse read live.
      row("member.read", "grant", new Date(Date.now() - 60_000)),
    ]);

    const [member] = (await repository().list(acme, { limit: 25, offset: 0 })).items;
    expect(member?.exceptions).toBe(2);
    expect((await repository().findByUser(acme, ada))?.exceptions).toBe(2);

    const roles = await new PgRoleRepository(
      DatabaseCluster.single(database),
      new TransactionScope(),
      shards,
    ).list(acme, { limit: 25, offset: 0 });
    expect(roles.items.find((role) => role.key === "owner")?.membersWithExceptions).toBe(1);
    expect(roles.items.find((role) => role.key === "member")?.membersWithExceptions).toBe(0);

    await database.client.delete(permissionOverrides).where(eq(permissionOverrides.userId, ada));
  });
});
