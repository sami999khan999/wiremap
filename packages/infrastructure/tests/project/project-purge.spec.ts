import { PurgeProjectUseCase } from "@loadbearing/application";
import {
  type CommentId,
  type GraphViewId,
  Identifiers,
  type OrganizationId,
  type ProjectId,
  type RepositoryId,
  type ScanId,
  type UserId,
  type WebhookId,
} from "@loadbearing/contracts";
import { Uuid } from "@loadbearing/core";
import { eq, inArray, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "../../src/pg/primitive/index.js";
import { DatabaseCluster } from "../../src/pg/primitive/index.js";
import { PgCommentRepository } from "../../src/pg/repository/pg-comment.repository.js";
import { PgGraphViewRepository } from "../../src/pg/repository/pg-graph-view.repository.js";
import { PgOrganizationFounder } from "../../src/pg/repository/pg-organization.founder.js";
import { PgProjectRepository } from "../../src/pg/repository/pg-project.repository.js";
import { PgScanRepository } from "../../src/pg/repository/pg-scan.repository.js";
import { PgWebhookRepository } from "../../src/pg/repository/pg-webhook.repository.js";
import { organizations, users } from "../../src/pg/schema/index.js";
import { ShardScope, TransactionScope } from "../../src/pg/transaction/index.js";
import { openDatabase } from "../support/database.js";
import { RecordingLogger } from "../support/recording.logger.js";

const shards = new ShardScope();
let database: Database;
let cluster: DatabaseCluster;
let acme: OrganizationId;
let owner: UserId;

const repos = () => {
  const scope = new TransactionScope();
  return {
    projects: new PgProjectRepository(cluster, scope, shards),
    scans: new PgScanRepository(cluster, scope, shards),
    views: new PgGraphViewRepository(cluster, scope, shards),
    comments: new PgCommentRepository(cluster, scope, shards),
    webhooks: new PgWebhookRepository(cluster, scope, shards),
  };
};

// Object storage as a set of keys: all the purge needs is listing a prefix and deleting.
class MemoryStorage {
  public readonly keys = new Set<string>();
  public list(prefix: string) {
    return Promise.resolve([...this.keys].filter((key) => key.startsWith(prefix)).slice(0, 1000));
  }
  public delete(key: string) {
    this.keys.delete(key);
    return Promise.resolve();
  }
}

// A project with something in every place a project leaves data.
const fill = async (storage: MemoryStorage) => {
  const r = repos();
  const id = Uuid.v7() as ProjectId;
  await r.projects.save(acme, {
    id,
    slug: `purge-${id.slice(-8)}`,
    name: "Purged",
    description: null,
    visibility: "restricted",
    defaultRole: "project_viewer",
    schedule: "off",
    ignore: [],
    settings: { tsconfigPath: null, workspace: null },
  });
  await r.projects.addRepository(acme, id, {
    id: Uuid.v7() as RepositoryId,
    provider: "upload",
    externalId: null,
    fullName: "acme/api",
    defaultBranch: "main",
    private: true,
    installationId: null,
  });
  await r.projects.saveGrant(acme, id, { userId: owner, teamId: null, role: "project_admin" });
  const scanId = Uuid.v7() as ScanId;
  await r.scans.create(acme, {
    id: scanId,
    projectId: id,
    trigger: "upload",
    state: "queued",
    branch: null,
    commitSha: null,
    requestedBy: owner,
  });
  await r.scans.replaceFindings(acme, id, scanId, {
    added: [{ kind: "cycle", key: "a.ts>b.ts" }],
    removed: [],
  });
  await r.views.save(acme, {
    id: Uuid.v7() as GraphViewId,
    projectId: id,
    name: "Mine",
    state: "",
    createdBy: owner,
  });
  await r.comments.save(acme, {
    id: Uuid.v7() as CommentId,
    projectId: id,
    target: { kind: "project", key: "" },
    body: "note",
    authorId: owner,
    parentId: null,
  });
  await r.webhooks.save(acme, {
    id: Uuid.v7() as WebhookId,
    projectId: id,
    kind: "generic",
    encryptedUrl: "v1:x",
    urlHint: "h.test/…x",
    encryptedSecret: null,
    events: ["scan.failed"],
  });
  storage.keys.add(`graphs/${acme}/${id}/${scanId}.json.gz`);
  return id;
};

// Rows naming the project, table by table: what a purge must bring to zero.
const remaining = async (projectId: ProjectId) => {
  const tables = [
    "projects",
    "project_repositories",
    "project_grants",
    "scans",
    "scan_findings",
    "graph_views",
    "comments",
    "webhooks",
  ] as const;
  const counts: Record<string, number> = {};
  for (const table of tables) {
    const column = table === "projects" ? "id" : "project_id";
    const result = await database.client.execute<{ count: string }>(
      sql`select count(*)::text as count from ${sql.identifier(table)}
          where organization_id = ${acme} and ${sql.identifier(column)} = ${projectId}`,
    );
    counts[table] = Number(result.rows[0]?.count ?? "0");
  }
  return counts;
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

describe("PurgeProjectUseCase against Postgres", () => {
  it("leaves no row and no object of a deleted project, and touches no other project", async () => {
    const storage = new MemoryStorage();
    const doomed = await fill(storage);
    const kept = await fill(storage);
    const r = repos();
    await r.projects.markDeleted(acme, doomed, new Date());

    const purge = new PurgeProjectUseCase(r.projects, storage as never, [
      r.scans,
      r.views,
      r.comments,
      r.webhooks,
    ]);
    expect(await purge.execute({ organizationId: acme, projectId: doomed })).toEqual({
      objects: 1,
    });

    expect(Object.values(await remaining(doomed)).every((count) => count === 0)).toBe(true);
    expect(await remaining(doomed)).toMatchObject({ projects: 0, webhooks: 0, comments: 0 });
    expect([...storage.keys].some((key) => key.includes(doomed))).toBe(false);

    expect(Object.values(await remaining(kept)).every((count) => count === 1)).toBe(true);
    expect([...storage.keys].some((key) => key.includes(kept))).toBe(true);
  });
});
