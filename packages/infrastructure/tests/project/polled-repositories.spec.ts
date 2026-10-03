import {
  Identifiers,
  type OrganizationId,
  type ProjectId,
  type RepositoryId,
  type UserId,
} from "@loadbearing/contracts";
import { Uuid } from "@loadbearing/core";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "../../src/pg/primitive/index.js";
import { DatabaseCluster } from "../../src/pg/primitive/index.js";
import { PgOrganizationFounder } from "../../src/pg/repository/pg-organization.founder.js";
import { PgProjectRepository } from "../../src/pg/repository/pg-project.repository.js";
import { organizations, users } from "../../src/pg/schema/index.js";
import { ShardScope, TransactionScope } from "../../src/pg/transaction/index.js";
import { openDatabase } from "../support/database.js";
import { RecordingLogger } from "../support/recording.logger.js";

const shards = new ShardScope();
let database: Database;
let cluster: DatabaseCluster;
let acme: OrganizationId;
let owner: UserId;
const repo = () => new PgProjectRepository(cluster, new TransactionScope(), shards);

const project = async (repositories: { provider: "github" | "upload"; branches?: string[] }[]) => {
  const id = Uuid.v7() as ProjectId;
  await repo().save(acme, {
    id,
    slug: `poll-${id.slice(-8)}`,
    name: "Polled",
    description: null,
    visibility: "org",
    defaultRole: "project_viewer",
    schedule: "off",
    ignore: [],
    settings: { tsconfigPath: null, workspace: null },
  });
  for (const [index, each] of repositories.entries()) {
    const repositoryId = Uuid.v7() as RepositoryId;
    await repo().addRepository(acme, id, {
      id: repositoryId,
      provider: each.provider,
      externalId: each.provider === "github" ? String(Date.now() + index) : null,
      fullName: `acme/r${index}-${id.slice(-4)}`,
      defaultBranch: "main",
      private: true,
      installationId: each.provider === "github" ? 77 : null,
    });
    if (each.branches)
      await repo().updateRepository(acme, id, repositoryId, { branches: each.branches } as never);
  }
  return id;
};

beforeAll(async () => {
  database = openDatabase();
  cluster = DatabaseCluster.single(database);
  owner = Identifiers.userId.parse(Uuid.v7());
  await database.client
    .insert(users)
    .values({ id: owner, name: "Owner", email: `${owner}@example.test`, emailVerified: true });
  // No audit rows: they would reach the outbox, and `pg-outbox.spec.ts` drains it whole.
  const activity = { record: () => Promise.resolve() } as never;
  acme = await new PgOrganizationFounder(
    cluster,
    new TransactionScope(),
    shards,
    activity,
    new RecordingLogger(),
  ).found(owner, "Acme");
});

afterAll(async () => {
  await database.client.delete(organizations).where(eq(organizations.id, acme));
  await database.client.delete(users).where(inArray(users.id, [owner]));
  await database.close();
});

describe("PgProjectRepository.polledRepositories", () => {
  it("lists live GitHub repositories with their branches, the default when none were picked", async () => {
    const live = await project([{ provider: "github" }, { provider: "upload" }]);
    const deleted = await project([{ provider: "github" }]);
    await repo().markDeleted(acme, deleted, new Date());

    const mine = (await repo().polledRepositories()).filter((each) => each.organizationId === acme);
    expect(mine.map((each) => each.projectId)).toEqual([live]);
    expect(mine[0]).toMatchObject({ installationId: 77, branches: ["main"] });
  });
});
