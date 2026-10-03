import {
  Identifiers,
  type OrganizationId,
  type RoleId,
  type TeamId,
  type UserId,
} from "@loadbearing/contracts";
import { SystemClock, Token, Uuid } from "@loadbearing/core";
import { and, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "../../src/pg/primitive/index.js";
import { DatabaseCluster } from "../../src/pg/primitive/index.js";
import { PgActivityLogger } from "../../src/pg/repository/pg-activity.logger.js";
import { PgActivityReader } from "../../src/pg/repository/pg-activity.reader.js";
import { PgInvitationLinkClaimer } from "../../src/pg/repository/pg-invitation-link.claimer.js";
import { PgInvitationLinkRepository } from "../../src/pg/repository/pg-invitation-link.repository.js";
import { PgMemberRepository } from "../../src/pg/repository/pg-member.repository.js";
import { PgMemberDomainClaimer } from "../../src/pg/repository/pg-member-domain.claimer.js";
import { PgMemberDomainRepository } from "../../src/pg/repository/pg-member-domain.repository.js";
import { PgOrganizationFounder } from "../../src/pg/repository/pg-organization.founder.js";
import { PgTeamRepository } from "../../src/pg/repository/pg-team.repository.js";
import { memberships, organizations, roles, users } from "../../src/pg/schema/index.js";
import { ShardScope, TransactionScope } from "../../src/pg/transaction/index.js";
import { openDatabase } from "../support/database.js";
import { RecordingLogger } from "../support/recording.logger.js";

const shards = new ShardScope();
const events = { publish: () => Promise.resolve() };
let database: Database;
let cluster: DatabaseCluster;
const created: UserId[] = [];
const founded: OrganizationId[] = [];
let owner: UserId;
let acme: OrganizationId;
let memberRole: RoleId;
// One domain per run, so a run that crashed before its sweep cannot collide with the next.
const DOMAIN = `wm-${Uuid.v7().slice(0, 8)}.test`;

const makeUser = async (name: string, options: { domain?: string; verified?: boolean } = {}) => {
  const id = Identifiers.userId.parse(Uuid.v7());
  await database.client.insert(users).values({
    id,
    name,
    email: `${id}@${options.domain ?? "example.test"}`,
    emailVerified: options.verified ?? true,
  });
  created.push(id);
  return id;
};

// One scope shared by a writer and its audit logger, as the kit's specs do: the audit row has
// to join the writer's transaction, or it lands before the partition it needs exists.
const withActivity = () => {
  const scope = new TransactionScope();
  return { scope, activity: new PgActivityLogger(cluster, scope, shards, new SystemClock()) };
};

beforeAll(async () => {
  database = openDatabase();
  cluster = DatabaseCluster.single(database);
  owner = await makeUser("Ada");
  const { scope, activity } = withActivity();
  const founder = new PgOrganizationFounder(
    cluster,
    scope,
    shards,
    activity,
    new RecordingLogger(),
  );
  acme = await founder.found(owner, "Acme");
  founded.push(acme);
  const [role] = await database.client
    .select({ id: roles.id })
    .from(roles)
    .where(and(eq(roles.organizationId, acme), eq(roles.key, "member")));
  memberRole = role?.id as RoleId;
});

afterAll(async () => {
  for (const organizationId of founded) {
    await database.client.delete(organizations).where(eq(organizations.id, organizationId));
  }
  await database.client.delete(users).where(inArray(users.id, created));
  await database.close();
});

describe("PgTeamRepository", () => {
  it("creates, counts, renames case-insensitively, and loses members with the team", async () => {
    const teams = new PgTeamRepository(cluster, new TransactionScope(), shards);
    const id = Uuid.v7() as TeamId;
    await teams.save(acme, { id, name: "Backend", description: null });

    expect(await teams.existsByName(acme, "backend")).toBe(true);
    expect(await teams.existsByName(acme, "backend", id)).toBe(false);

    await teams.addMember(acme, id, owner);
    await teams.addMember(acme, id, owner);
    expect((await teams.findById(acme, id))?.memberCount).toBe(1);
    expect((await teams.members(acme, id)).map((member) => member.userId)).toEqual([owner]);

    await teams.save(acme, { id, name: "Platform", description: "infra" });
    expect((await teams.findById(acme, id))?.name).toBe("Platform");

    await teams.delete(acme, id);
    expect(await teams.findById(acme, id)).toBeNull();
  });
});

describe("PgMemberRepository.delete", () => {
  it("ends the membership and the person's team places in that tenant", async () => {
    const grace = await makeUser("Grace");
    await database.client
      .insert(memberships)
      .values({ id: Uuid.v7(), organizationId: acme, userId: grace, roleId: memberRole });
    const teams = new PgTeamRepository(cluster, new TransactionScope(), shards);
    const team = Uuid.v7() as TeamId;
    await teams.save(acme, { id: team, name: `t-${team}`, description: null });
    await teams.addMember(acme, team, grace);

    await new PgMemberRepository(cluster, new TransactionScope(), shards).delete(acme, grace);

    expect(
      await new PgMemberRepository(cluster, new TransactionScope(), shards).findByUser(acme, grace),
    ).toBeNull();
    expect(await teams.members(acme, team)).toEqual([]);
  });
});

describe("PgInvitationLinkClaimer", () => {
  it("admits a verified account until the link runs out, and spends no use on a member", async () => {
    const links = new PgInvitationLinkRepository(cluster, new TransactionScope(), shards);
    const token = Token.random();
    const id = Identifiers.invitationLinkId.parse(Uuid.v7());
    await links.save(acme, {
      id,
      roleId: memberRole,
      createdBy: owner,
      tokenHash: await Token.hash(token),
      expiresAt: new Date(Date.now() + 86_400_000),
      maxUses: 1,
    });
    const claimer = (() => {
      const { scope, activity } = withActivity();
      return new PgInvitationLinkClaimer(cluster, scope, shards, activity, events as never);
    })();

    expect((await claimer.preview(token))?.usable).toBe(true);
    expect(await claimer.claimByToken(owner, token)).toBe(acme);
    expect((await links.findById(acme, id))?.uses).toBe(0);

    const first = await makeUser("Joiner");
    const second = await makeUser("Late");
    const unverified = await makeUser("Unverified", { verified: false });
    expect(await claimer.claimByToken(unverified, token)).toBeNull();
    expect(await claimer.claimByToken(first, token)).toBe(acme);
    expect(await claimer.claimByToken(second, token)).toBeNull();
    expect((await claimer.preview(token))?.usable).toBe(false);
  });
});

describe("PgMemberDomainClaimer", () => {
  it("joins a verified address at a claimed domain, and only that", async () => {
    const domains = new PgMemberDomainRepository(cluster, new TransactionScope(), shards);
    await domains.save(acme, {
      id: Identifiers.domainId.parse(Uuid.v7()),
      domain: DOMAIN,
      roleId: memberRole,
      createdBy: owner,
    });
    expect(await domains.isClaimed(DOMAIN)).toBe(true);

    const claimer = (() => {
      const { scope, activity } = withActivity();
      return new PgMemberDomainClaimer(cluster, scope, shards, activity, events as never);
    })();
    const colleague = await makeUser("Colleague", { domain: DOMAIN });
    const stranger = await makeUser("Stranger");
    const unverified = await makeUser("Pending", { domain: DOMAIN, verified: false });

    expect(await claimer.claimByDomain(colleague)).toBe(acme);
    expect(await claimer.claimByDomain(stranger)).toBeNull();
    expect(await claimer.claimByDomain(unverified)).toBeNull();
  });
});

describe("PgActivityReader", () => {
  it("reads the tenant's trail newest first, filtered by action", async () => {
    const reader = new PgActivityReader(cluster, new TransactionScope(), shards);

    const page = await reader.list(acme, { limit: 50 });
    const joined = await reader.list(acme, { limit: 50, action: "member.joined" });

    expect(page.items.length).toBeGreaterThan(0);
    const times = page.items.map((item) => item.occurredAt.getTime());
    expect([...times].sort((left, right) => right - left)).toEqual(times);
    expect(joined.items.every((item) => item.action === "member.joined")).toBe(true);
  });
});
