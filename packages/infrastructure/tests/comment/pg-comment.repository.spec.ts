import {
  type CommentId,
  Identifiers,
  type OrganizationId,
  type ProjectId,
  type UserId,
} from "@loadbearing/contracts";
import { Uuid } from "@loadbearing/core";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "../../src/pg/primitive/index.js";
import { DatabaseCluster } from "../../src/pg/primitive/index.js";
import { PgCommentRepository } from "../../src/pg/repository/pg-comment.repository.js";
import { PgOrganizationFounder } from "../../src/pg/repository/pg-organization.founder.js";
import { organizations, users } from "../../src/pg/schema/index.js";
import { ShardScope, TransactionScope } from "../../src/pg/transaction/index.js";
import { openDatabase } from "../support/database.js";
import { RecordingLogger } from "../support/recording.logger.js";

const shards = new ShardScope();
let database: Database;
let cluster: DatabaseCluster;
let acme: OrganizationId;
let owner: UserId;
const project = Uuid.v7() as ProjectId;
const other = Uuid.v7() as ProjectId;
const repository = () => new PgCommentRepository(cluster, new TransactionScope(), shards);

const write = async (
  key: string,
  projectId: ProjectId = project,
  parentId: CommentId | null = null,
) => {
  const id = Uuid.v7() as CommentId;
  await repository().save(acme, {
    id,
    projectId,
    target: { kind: "file", key },
    body: `on ${key}`,
    authorId: owner,
    parentId,
  });
  return id;
};

beforeAll(async () => {
  shards.enter({ key: "spec" as never, node: 0 });
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

describe("PgCommentRepository", () => {
  it("lists a project's comments oldest first, or one target's", async () => {
    const first = await write("src/a.ts");
    const second = await write("src/b.ts");
    await write("src/a.ts", other);

    const all = await repository().list(acme, project, null);
    expect(all.map((comment) => comment.id)).toEqual([first, second]);
    const one = await repository().list(acme, project, { kind: "file", key: "src/b.ts" });
    expect(one.map((comment) => comment.id)).toEqual([second]);
  });

  it("edits, resolves and pins in place", async () => {
    const id = await write("src/c.ts");
    const at = new Date();
    await repository().edit(acme, id, "changed", at);
    await repository().setResolved(acme, id, at);
    await repository().setPinned(acme, id, true);

    const comment = await repository().findById(acme, id);
    expect(comment).toMatchObject({ body: "changed", pinned: true });
    expect(comment?.editedAt).toBeInstanceOf(Date);
    expect(comment?.resolvedAt).toBeInstanceOf(Date);
  });

  // The row stays so its replies keep their thread; it simply stops being read, or a note.
  it("hides a removed comment and drops its pin, keeping its replies", async () => {
    const root = await write("src/d.ts");
    const reply = await write("src/d.ts", project, root);
    await repository().setPinned(acme, root, true);
    await repository().remove(acme, root, new Date());

    expect(await repository().findById(acme, root)).toBeNull();
    expect(await repository().findById(acme, reply)).not.toBeNull();
  });

  it("removes every comment of one project and none of another's", async () => {
    await repository().removeForProject(acme, project);
    expect(await repository().list(acme, project, null)).toEqual([]);
    expect(await repository().list(acme, other, null)).toHaveLength(1);
  });
});
