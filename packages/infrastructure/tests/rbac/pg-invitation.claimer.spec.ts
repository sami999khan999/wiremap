import { Identifiers, type OrganizationId, type RoleId, type UserId } from "@loadbearing/contracts";
import { SystemClock, Token, Uuid } from "@loadbearing/core";
import { and, eq, inArray, type Logger } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "../../src/pg/primitive/index.js";
import { DatabaseCluster } from "../../src/pg/primitive/index.js";
import { PgActivityLogger } from "../../src/pg/repository/pg-activity.logger.js";
import { PgInvitationClaimer } from "../../src/pg/repository/pg-invitation.claimer.js";
import { PgOrganizationFounder } from "../../src/pg/repository/pg-organization.founder.js";
import { PgOutboxPublisher } from "../../src/pg/repository/pg-outbox.publisher.js";
import {
  activityLog,
  invitations,
  memberships,
  organizations,
  roles,
  users,
} from "../../src/pg/schema/index.js";
import { ShardScope, TransactionScope } from "../../src/pg/transaction/index.js";
import { openDatabase } from "../support/database.js";
import { RecordingLogger } from "../support/recording.logger.js";

// One node, so nothing is ever placed: every repository here resolves to it.
const shards = new ShardScope();

// Captures the SQL the claimer actually issued, so the predicate assertion below is
// against the query under test rather than a copy of it that can drift.
class RecordingQueryLogger implements Logger {
  public readonly queries: string[] = [];

  public logQuery(query: string): void {
    this.queries.push(query);
  }
}

const recorder = new RecordingQueryLogger();
let database: Database;
const created: UserId[] = [];
const founded: OrganizationId[] = [];

// The organization every invitation in this file points at, and its `member` role.
let home: OrganizationId;
let memberRole: RoleId;
let inviter: UserId;

const DAY = 24 * 60 * 60 * 1000;

const makeUser = async (name = "Ada", verified = true) => {
  const id = Identifiers.userId.parse(Uuid.v7());
  await database.client.insert(users).values({
    id,
    name,
    email: `${id}@example.test`,
    emailVerified: verified,
  });
  created.push(id);
  return id;
};

const emailOf = (userId: UserId) => `${userId}@example.test`;

const invite = async (
  email: string,
  options: { organizationId?: OrganizationId; expiresIn?: number; createdAt?: Date } = {},
) => {
  const id = Uuid.v7();
  const token = Token.random();
  await database.client.insert(invitations).values({
    id,
    organizationId: options.organizationId ?? home,
    email: email.toLowerCase(),
    roleId: memberRole,
    // What the row holds is the digest; the claimer hashes on the way in.
    tokenHash: await Token.hash(token),
    invitedBy: Identifiers.userId.parse(inviter),
    expiresAt: new Date(Date.now() + (options.expiresIn ?? DAY)),
    ...(options.createdAt ? { createdAt: options.createdAt } : {}),
  });
  return { id, token };
};

const withScope = () => {
  const scope = new TransactionScope();
  const activity = new PgActivityLogger(
    DatabaseCluster.single(database),
    scope,
    shards,
    new SystemClock(),
  );
  // The real publisher, not a double: a claim writes its event in the same transaction as
  // the membership row, and that is the property this spec is here to hold.
  const events = new PgOutboxPublisher(
    DatabaseCluster.single(database),
    scope,
    shards,
    new SystemClock(),
  );
  return {
    claimer: new PgInvitationClaimer(
      DatabaseCluster.single(database),
      scope,
      shards,
      activity,
      events,
    ),
    founder: new PgOrganizationFounder(
      DatabaseCluster.single(database),
      scope,
      shards,
      activity,
      new RecordingLogger(),
    ),
  };
};

const membershipsOf = (userId: UserId) =>
  database.client
    .select({ organizationId: memberships.organizationId, roleId: memberships.roleId })
    .from(memberships)
    .where(eq(memberships.userId, userId));

const invitationById = (id: string) =>
  database.client.select({ id: invitations.id }).from(invitations).where(eq(invitations.id, id));

beforeAll(async () => {
  database = openDatabase(recorder);
  inviter = await makeUser("Inviter");
  home = await withScope().founder.found(Identifiers.userId.parse(inviter), "Home");
  founded.push(home);
  const [role] = await database.client
    .select({ id: roles.id })
    .from(roles)
    .where(and(eq(roles.organizationId, home), eq(roles.key, "member")));
  if (!role) throw new Error("SystemRoleSeed did not seed a member role");
  memberRole = Identifiers.roleId.parse(role.id);
});

afterAll(async () => {
  // Users cascade their memberships and the invitations they sent; roles and
  // organizations are cleaned by hand in FK order.
  if (created.length > 0) {
    await database.client.delete(users).where(inArray(users.id, created));
  }
  for (const organizationId of founded) {
    await database.client.delete(roles).where(eq(roles.organizationId, organizationId));
    await database.client.delete(organizations).where(eq(organizations.id, organizationId));
  }
  await database.close();
});

describe("PgInvitationClaimer", () => {
  it("turns a pending invitation into a membership at the invited role and consumes it", async () => {
    const userId = await makeUser();
    const { id, token } = await invite(emailOf(userId));

    const result = await withScope().claimer.claimByToken(userId, token);

    expect(result).toBe(home);
    expect(await membershipsOf(userId)).toEqual([{ organizationId: home, roleId: memberRole }]);
    expect(await invitationById(id)).toHaveLength(0);

    const audit = await database.client
      .select({ actorId: activityLog.actorId, payload: activityLog.payload })
      .from(activityLog)
      .where(and(eq(activityLog.organizationId, home), eq(activityLog.action, "member.joined")));
    expect(audit.some((row) => row.actorId === userId)).toBe(true);
  });

  // The regression guard for a table that held bearer tokens in plaintext. The column
  // holds a digest now, so a dump of `invitations` carries nothing anyone can accept with.
  it("stores the digest and never the token", async () => {
    const userId = await makeUser();
    const { id, token } = await invite(emailOf(userId));

    const [row] = await database.client
      .select({ tokenHash: invitations.tokenHash })
      .from(invitations)
      .where(eq(invitations.id, id));

    expect(row?.tokenHash).not.toBe(token);
    expect(row?.tokenHash).toBe(await Token.hash(token));

    // And the lookup still finds it, which is the half that would silently break.
    expect(await withScope().claimer.claimByToken(userId, token)).toBe(home);
  });

  // The security property. A token is a locator; the verified mailbox is the credential.
  it("refuses an address the invitation was not sent to, and leaves it pending", async () => {
    const userId = await makeUser();
    const { id, token } = await invite("someone-else@example.test");

    expect(await withScope().claimer.claimByToken(userId, token)).toBeNull();
    expect(await membershipsOf(userId)).toHaveLength(0);
    expect(await invitationById(id)).toHaveLength(1);
  });

  it("refuses an unverified address even when it matches", async () => {
    const userId = await makeUser("Unverified", false);
    const { token } = await invite(emailOf(userId));

    expect(await withScope().claimer.claimByToken(userId, token)).toBeNull();
    expect(await membershipsOf(userId)).toHaveLength(0);
  });

  it("refuses an expired invitation", async () => {
    const userId = await makeUser();
    const { token } = await invite(emailOf(userId), { expiresIn: -DAY });

    expect(await withScope().claimer.claimByToken(userId, token)).toBeNull();
  });

  it("matches the address case-insensitively", async () => {
    const userId = await makeUser();
    const { token } = await invite(emailOf(userId).toUpperCase());

    expect(await withScope().claimer.claimByToken(userId, token)).toBe(home);
  });

  // `memberships_uq` is on (organization_id, user_id): a second invitation to someone
  // already in the tenant is consumed without touching the role they hold.
  it("is idempotent for someone who is already a member", async () => {
    const userId = await makeUser();
    const first = await invite(emailOf(userId));
    await withScope().claimer.claimByToken(userId, first.token);
    const second = await invite(emailOf(userId));

    const result = await withScope().claimer.claimByToken(userId, second.token);

    expect(result).toBe(home);
    expect(await membershipsOf(userId)).toHaveLength(1);
    expect(await invitationById(second.id)).toHaveLength(0);
  });

  // The enrolment path: no token in hand, oldest invitation wins.
  it("claimPending takes the oldest pending invitation for the address", async () => {
    const userId = await makeUser();
    const other = await withScope().founder.found(Identifiers.userId.parse(inviter), "Other");
    founded.push(other);
    const [otherMember] = await database.client
      .select({ id: roles.id })
      .from(roles)
      .where(and(eq(roles.organizationId, other), eq(roles.key, "member")));
    // The newer invitation is to `home`; the older one, inserted with a back-dated
    // `createdAt`, is to `other` — so the answer is `other` if ordering is honoured.
    await invite(emailOf(userId));
    await database.client.insert(invitations).values({
      id: Uuid.v7(),
      organizationId: other,
      email: emailOf(userId),
      roleId: otherMember?.id ?? memberRole,
      tokenHash: await Token.hash(Token.random()),
      invitedBy: Identifiers.userId.parse(inviter),
      expiresAt: new Date(Date.now() + DAY),
      createdAt: new Date(Date.now() - DAY),
    });

    expect(await withScope().claimer.claimPending(userId)).toBe(other);
    // Only the claimed one is consumed; the other stays pending for the next call.
    expect(await withScope().claimer.claimPending(userId)).toBe(home);
    expect(await withScope().claimer.claimPending(userId)).toBeNull();
  });

  it("previews the organization and the address, and flags expiry", async () => {
    const live = await invite("preview@example.test");
    const stale = await invite("stale@example.test", { expiresIn: -DAY });
    const { claimer } = withScope();

    expect(await claimer.preview(live.token)).toEqual({
      organizationName: "Home",
      email: "preview@example.test",
      expired: false,
    });
    expect((await claimer.preview(stale.token))?.expired).toBe(true);
    expect(await claimer.preview("no-such-token")).toBeNull();
  });

  // The regression guard: the predicate was `lower(invitations.email)` although the
  // column is stored lowercased, which made `invitations_email_idx` unusable.
  it("matches the email column itself, never an expression over it", async () => {
    const userId = await makeUser();
    await invite(emailOf(userId));

    recorder.queries.length = 0;
    await withScope().claimer.claimPending(userId);

    const lookup = recorder.queries.filter(
      (query) => query.includes('from "invitations"') && query.includes('"email"'),
    );

    expect(lookup).not.toHaveLength(0);
    expect(lookup.some((query) => /lower\(/i.test(query))).toBe(false);
  });
});
