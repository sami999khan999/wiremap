import {
  Identifiers,
  type OrganizationId,
  type ProjectId,
  type RoleId,
  type TeamId,
  type UserId,
} from "@loadbearing/contracts";
import { SystemClock, Uuid } from "@loadbearing/core";
import { eq, inArray, type Logger } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "../../src/pg/primitive/index.js";
import { DatabaseCluster } from "../../src/pg/primitive/index.js";
import { PgActivityLogger } from "../../src/pg/repository/pg-activity.logger.js";
import { PgCapabilityRepository } from "../../src/pg/repository/pg-capability.repository.js";
import { PgOrganizationFounder } from "../../src/pg/repository/pg-organization.founder.js";
import { PgProjectRepository } from "../../src/pg/repository/pg-project.repository.js";
import { PgTeamRepository } from "../../src/pg/repository/pg-team.repository.js";
import { memberships, organizations, roles, users } from "../../src/pg/schema/index.js";
import { ShardScope, TransactionScope } from "../../src/pg/transaction/index.js";
import { openDatabase } from "../support/database.js";
import { RecordingLogger } from "../support/recording.logger.js";

class CountingLogger implements Logger {
  public count = 0;
  public logQuery(): void {
    this.count += 1;
  }
}

const shards = new ShardScope();
const counter = new CountingLogger();
let database: Database;
let cluster: DatabaseCluster;
const created: UserId[] = [];
let acme: OrganizationId;
const roleIds = new Map<string, RoleId>();

const makeUser = async (name: string) => {
  const id = Identifiers.userId.parse(Uuid.v7());
  await database.client
    .insert(users)
    .values({ id, name, email: `${id}@example.test`, emailVerified: true });
  created.push(id);
  return id;
};

const join = async (role: string) => {
  const userId = await makeUser(role);
  await database.client.insert(memberships).values({
    id: Uuid.v7(),
    organizationId: acme,
    userId,
    roleId: roleIds.get(role) as RoleId,
  });
  return userId;
};

const projectsRepo = () => new PgProjectRepository(cluster, new TransactionScope(), shards);
const capabilities = () => new PgCapabilityRepository(cluster, new TransactionScope(), shards);

const project = async (visibility: "org" | "restricted") => {
  const id = Uuid.v7() as ProjectId;
  await projectsRepo().save(acme, {
    id,
    slug: `p-${id.slice(-8)}`,
    name: `Project ${id.slice(-4)}`,
    description: null,
    visibility,
    defaultRole: "project_editor",
    schedule: "off",
    ignore: [],
    settings: { tsconfigPath: null, workspace: null },
  });
  return id;
};

beforeAll(async () => {
  database = openDatabase(counter);
  cluster = DatabaseCluster.single(database);
  const owner = await makeUser("Owner");
  const scope = new TransactionScope();
  const activity = new PgActivityLogger(cluster, scope, shards, new SystemClock());
  acme = await new PgOrganizationFounder(
    cluster,
    scope,
    shards,
    activity,
    new RecordingLogger(),
  ).found(owner, "Acme");
  const rows = await database.client
    .select({ id: roles.id, key: roles.key })
    .from(roles)
    .where(eq(roles.organizationId, acme));
  for (const row of rows) roleIds.set(row.key, row.id as RoleId);
});

afterAll(async () => {
  await database.client.delete(organizations).where(eq(organizations.id, acme));
  await database.client.delete(users).where(inArray(users.id, created));
  await database.close();
});

describe("PgCapabilityRepository — projects", () => {
  it("gives every member an org project's default role, and a viewer only reading", async () => {
    const id = await project("org");
    const member = await join("member");
    const viewer = await join("viewer");

    const memberSet = await capabilities().resolveFor(acme, member);
    const viewerSet = await capabilities().resolveFor(acme, viewer);

    expect(memberSet.can("project.graph.read", id)).toBe(true);
    expect(memberSet.can("project.settings.manage", id)).toBe(false);
    expect(viewerSet.can("project.graph.read", id)).toBe(true);
    expect(viewerSet.can("project.delete", id)).toBe(false);
  });

  it("hides a restricted project until a direct or a team grant opens it", async () => {
    const id = await project("restricted");
    const direct = await join("member");
    const teamed = await join("member");
    const outsider = await join("member");

    await projectsRepo().saveGrant(acme, id, {
      userId: direct,
      teamId: null,
      role: "project_admin",
    });
    const teams = new PgTeamRepository(cluster, new TransactionScope(), shards);
    const team = Uuid.v7() as TeamId;
    await teams.save(acme, { id: team, name: `t-${team}`, description: null });
    await teams.addMember(acme, team, teamed);
    await projectsRepo().saveGrant(acme, id, {
      userId: null,
      teamId: team,
      role: "project_viewer",
    });

    expect((await capabilities().resolveFor(acme, outsider)).can("project.graph.read", id)).toBe(
      false,
    );
    expect((await capabilities().resolveFor(acme, direct)).can("project.access.manage", id)).toBe(
      true,
    );
    const teamSet = await capabilities().resolveFor(acme, teamed);
    expect(teamSet.can("project.graph.read", id)).toBe(true);
    expect(teamSet.can("project.settings.manage", id)).toBe(false);
  });

  it("lets the higher of two grants win, and saving a grant again changes its role", async () => {
    const id = await project("restricted");
    const person = await join("member");

    const grant = await projectsRepo().saveGrant(acme, id, {
      userId: person,
      teamId: null,
      role: "project_viewer",
    });
    expect((await capabilities().resolveFor(acme, person)).can("project.access.manage", id)).toBe(
      false,
    );

    const again = await projectsRepo().saveGrant(acme, id, {
      userId: person,
      teamId: null,
      role: "project_admin",
    });
    expect(again).toBe(grant);
    expect((await capabilities().resolveFor(acme, person)).can("project.access.manage", id)).toBe(
      true,
    );
    expect((await projectsRepo().grants(acme, id)).map((row) => row.role)).toEqual([
      "project_admin",
    ]);
  });

  it("drops a deleted project from every grant, and still resolves in four statements", async () => {
    const id = await project("org");
    const member = await join("member");
    await projectsRepo().markDeleted(acme, id, new Date());

    counter.count = 0;
    const set = await capabilities().resolveFor(acme, member);

    expect(counter.count).toBe(4);
    expect(set.can("project.graph.read", id)).toBe(false);
    expect(await projectsRepo().findById(acme, id)).toBeNull();
  });
});

describe("PgProjectRepository", () => {
  it("lists projects with their repositories in two statements", async () => {
    const id = await project("org");
    await projectsRepo().addRepository(acme, id, {
      id: Identifiers.repositoryId.parse(Uuid.v7()),
      provider: "github",
      externalId: `ext-${id}`,
      fullName: "acme/api",
      defaultBranch: "main",
      private: true,
      installationId: 42,
    });

    counter.count = 0;
    const list = await projectsRepo().listAll(acme);

    expect(counter.count).toBe(2);
    const found = list.find((row) => row.id === id);
    expect(found?.repositories.map((row) => [row.fullName, row.branches])).toEqual([
      ["acme/api", ["main"]],
    ]);
    expect(await projectsRepo().trackingRepository("github", `ext-${id}`)).toHaveLength(1);
  });
});

describe("PgProjectRepository.reach", () => {
  it("names every source of access, and which roles already read every project", async () => {
    const id = await project("restricted");
    const person = await join("member");
    const teams = new PgTeamRepository(cluster, new TransactionScope(), shards);
    const team = Uuid.v7() as TeamId;
    await teams.save(acme, { id: team, name: `Core ${team.slice(-4)}`, description: null });
    await teams.addMember(acme, team, person);
    await projectsRepo().saveGrant(acme, id, {
      userId: null,
      teamId: team,
      role: "project_editor",
    });

    counter.count = 0;
    const reach = await projectsRepo().reach(acme);

    expect(counter.count).toBe(2);
    expect(reach.sources.filter((row) => row.projectId === id)).toEqual([
      {
        projectId: id,
        userId: person,
        role: "project_editor",
        via: "team",
        teamName: `Core ${team.slice(-4)}`,
      },
    ]);
    const roles = new Map(reach.members.map((row) => [row.roleKey, row.orgWide]));
    expect(roles.get("owner")).toBe(true);
    expect(roles.get("member")).toBe(false);
  });
});
