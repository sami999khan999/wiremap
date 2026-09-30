import {
  Identifiers,
  type InvitationId,
  type OrganizationId,
  type RoleId,
  type UserId,
} from "@loadbearing/contracts";
import { SystemClock, Token, Uuid } from "@loadbearing/core";
import { and, eq, inArray, type Logger } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "../../src/pg/primitive/index.js";
import { DatabaseCluster } from "../../src/pg/primitive/index.js";
import { PgActivityLogger } from "../../src/pg/repository/pg-activity.logger.js";
import { PgInvitationRepository } from "../../src/pg/repository/pg-invitation.repository.js";
import { PgOrganizationFounder } from "../../src/pg/repository/pg-organization.founder.js";
import { invitations, organizations, roles, users } from "../../src/pg/schema/index.js";
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
let acme: OrganizationId;
let other: OrganizationId;
let memberRole: RoleId;

const DAY = 24 * 60 * 60 * 1000;

const repository = () =>
  new PgInvitationRepository(DatabaseCluster.single(database), new TransactionScope(), shards);

const newInvitation = (email: string, overrides: { expiresAt?: Date } = {}) => ({
  id: Uuid.v7() as InvitationId,
  organizationId: acme,
  email,
  roleId: memberRole,
  // The digest. A repository is never handed a plaintext token to store.
  tokenHash: Token.random(),
  invitedBy: ada,
  expiresAt: overrides.expiresAt ?? new Date(Date.now() + DAY),
  createdAt: new Date(),
});

beforeAll(async () => {
  database = openDatabase(counter);
  ada = Identifiers.userId.parse(Uuid.v7());
  await database.client
    .insert(users)
    .values({ id: ada, name: "Ada", email: `${ada}@example.test`, emailVerified: true });
  created.push(ada);

  const scope = new TransactionScope();
  const founder = new PgOrganizationFounder(
    DatabaseCluster.single(database),
    scope,
    shards,
    new PgActivityLogger(DatabaseCluster.single(database), scope, shards, new SystemClock()),
    new RecordingLogger(),
  );
  acme = await founder.found(ada, "Acme");
  other = await founder.found(ada, "Other");
  founded.push(acme, other);

  const [role] = await database.client
    .select({ id: roles.id })
    .from(roles)
    .where(and(eq(roles.organizationId, acme), eq(roles.key, "member")));
  if (!role) throw new Error("SystemRoleSeed did not seed a member role");
  memberRole = role.id as RoleId;
});

afterAll(async () => {
  // Invitations cascade from the inviter; roles and organizations by hand, in FK order.
  await database.client.delete(users).where(inArray(users.id, created));
  for (const organizationId of founded) {
    await database.client.delete(roles).where(eq(roles.organizationId, organizationId));
    await database.client.delete(organizations).where(eq(organizations.id, organizationId));
  }
  await database.close();
});

describe("PgInvitationRepository", () => {
  it("saves a row and lists it joined to the names a list and a mail need", async () => {
    const invitation = newInvitation("list@example.test");

    await repository().save(invitation);
    const page = await repository().list(acme, { limit: 25, offset: 0 });

    expect(page.items.find((i) => i.id === invitation.id)).toMatchObject({
      email: "list@example.test",
      roleId: memberRole,
      roleName: "Member",
      invitedBy: ada,
      inviterName: "Ada",
      organizationName: "Acme",
    });
    // Never the token: the list is the administrator's view and the link is the
    // invited person's.
    expect(Object.keys(page.items[0] ?? {})).not.toContain("token");
    expect(Object.keys(page.items[0] ?? {})).not.toContain("tokenHash");
  });

  // "Two queries" decays silently — a name lifted per row inside the map makes it 2 + N,
  // invisible at one invitation and the whole request at four hundred.
  it("lists in exactly two queries", async () => {
    counter.count = 0;

    await repository().list(acme, { limit: 25, offset: 0 });

    expect(counter.count).toBe(2);
  });

  // `invitations_email_uq` on (organization_id, email): a second invitation to the same
  // address replaces the first, id included, so the old link stops working.
  it("replaces a pending invitation to the same address on save", async () => {
    const first = newInvitation("again@example.test");
    const second = newInvitation("again@example.test");

    await repository().save(first);
    await repository().save(second);

    const rows = await database.client
      .select({ id: invitations.id, tokenHash: invitations.tokenHash })
      .from(invitations)
      .where(
        and(eq(invitations.organizationId, acme), eq(invitations.email, "again@example.test")),
      );

    expect(rows).toEqual([{ id: second.id, tokenHash: second.tokenHash }]);
    expect(await repository().findById(acme, first.id)).toBeNull();
  });

  // What a resend does: the same row, a new digest, a later expiry. The `id` is unchanged,
  // so this conflicts on the primary key as well as on the email index it names.
  it("reissues the same invitation under its own id", async () => {
    const first = newInvitation("reissue@example.test");
    const later = new Date(Date.now() + 7 * DAY);
    const again = { ...first, tokenHash: Token.random(), expiresAt: later };

    await repository().save(first);
    await repository().save(again);

    const rows = await database.client
      .select({
        id: invitations.id,
        tokenHash: invitations.tokenHash,
        expiresAt: invitations.expiresAt,
      })
      .from(invitations)
      .where(
        and(eq(invitations.organizationId, acme), eq(invitations.email, "reissue@example.test")),
      );

    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(first.id);
    expect(rows[0]?.tokenHash).toBe(again.tokenHash);
    expect(rows[0]?.expiresAt?.getTime()).toBe(later.getTime());
  });

  it("hides an expired invitation from the list but still finds it by id", async () => {
    const stale = newInvitation("stale@example.test", { expiresAt: new Date(Date.now() - DAY) });

    await repository().save(stale);

    const page = await repository().list(acme, { limit: 100, offset: 0 });
    expect(page.items.some((i) => i.id === stale.id)).toBe(false);
    expect((await repository().findById(acme, stale.id))?.email).toBe("stale@example.test");
  });

  it("scopes reads and deletes by tenant", async () => {
    const invitation = newInvitation("scoped@example.test");
    await repository().save(invitation);

    expect(await repository().findById(other, invitation.id)).toBeNull();
    expect((await repository().list(other, { limit: 25, offset: 0 })).total).toBe(0);

    await repository().delete(other, invitation.id);
    expect(await repository().findById(acme, invitation.id)).not.toBeNull();

    await repository().delete(acme, invitation.id);
    expect(await repository().findById(acme, invitation.id)).toBeNull();
  });
});
