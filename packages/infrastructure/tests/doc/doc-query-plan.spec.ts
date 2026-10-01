import { type DocSpaceId, Identifiers, type OrganizationId } from "@loadbearing/contracts";
import { Uuid } from "@loadbearing/core";
import type { Logger } from "drizzle-orm";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Database, DatabaseCluster } from "../../src/pg/primitive/index.js";
import { PgDocPageRepository } from "../../src/pg/repository/pg-doc-page.repository.js";
import { PgDocSpaceRepository } from "../../src/pg/repository/pg-doc-space.repository.js";
import { ShardScope, TransactionScope } from "../../src/pg/transaction/index.js";
import { DATABASE_URL, openDatabase, seedOrganizationId } from "../support/database.js";

// Each reader path's statements, as the repository writes them, planned with sequential
// scans priced out: a doc table still read in full then has no index that serves the query.

class CapturingLogger implements Logger {
  public queries: { sql: string; params: unknown[] }[] = [];
  public logQuery(sql: string, params: unknown[]): void {
    this.queries.push({ sql, params });
  }
}

interface PlanNode {
  readonly "Node Type": string;
  readonly "Relation Name"?: string;
  readonly Plans?: readonly PlanNode[];
}

const shards = new ShardScope();
const logger = new CapturingLogger();
const client = new pg.Client({ connectionString: DATABASE_URL });
let database: Database;
let organizationId: OrganizationId;
const spaceId = Identifiers.docSpaceId.parse(Uuid.v7()) as DocSpaceId;
const slug = `plan-${spaceId.slice(-12)}`;
const author = Identifiers.userId.parse(Uuid.v7());

const spaces = () =>
  new PgDocSpaceRepository(DatabaseCluster.single(database), new TransactionScope(), shards);
const pages = () =>
  new PgDocPageRepository(DatabaseCluster.single(database), new TransactionScope(), shards);

// The scans that read a doc table: the parent's name, or a partition's, which starts with it.
const docScans = (node: PlanNode): PlanNode[] => [
  ...(node["Relation Name"]?.startsWith("doc_") ? [node] : []),
  ...(node.Plans ?? []).flatMap(docScans),
];

const plansOf = async (work: () => Promise<unknown>) => {
  logger.queries = [];
  await shards.atNode(0, work);
  const plans: PlanNode[] = [];
  for (const { sql, params } of logger.queries) {
    await client.query("begin");
    await client.query("set local enable_seqscan = off");
    const result = await client.query(`explain (format json) ${sql}`, params);
    await client.query("rollback");
    const [explained] = (result.rows[0] as { "QUERY PLAN": { Plan: PlanNode }[] })["QUERY PLAN"];
    if (explained) plans.push(explained.Plan);
  }
  return plans;
};

const expectIndexed = (plans: readonly PlanNode[]) => {
  const scans = plans.flatMap(docScans);
  expect(scans.length).toBeGreaterThan(0);
  for (const scan of scans) {
    expect(`${scan["Node Type"]} on ${scan["Relation Name"]}`).not.toMatch(/^Seq Scan/);
  }
};

beforeAll(async () => {
  database = openDatabase(logger);
  organizationId = await seedOrganizationId(database);
  await client.connect();
  await shards.atNode(0, () =>
    spaces().create(
      organizationId,
      spaceId,
      {
        slug,
        title: "Plans",
        description: null,
        icon: null,
        audience: "members",
        theme: null,
        access: null,
        repositoryUrl: null,
      },
      author,
    ),
  );
});

afterAll(async () => {
  await shards.atNode(0, () => spaces().delete(organizationId, spaceId));
  await client.end();
  await database.close();
});

describe("doc reader query plans", () => {
  it("finds a space by its slug through an index", async () => {
    expectIndexed(await plansOf(() => spaces().findBySlug(organizationId, slug)));
  });

  it("reads one published page through an index", async () => {
    const pageId = Identifiers.docPageId.parse(Uuid.v7());
    expectIndexed(await plansOf(() => pages().findPublished(organizationId, pageId)));
  });

  // Both halves of search: the text through the generated column, the titles by trigram.
  it("searches sections and titles through their indexes", async () => {
    expectIndexed(await plansOf(() => pages().search(organizationId, "install", 10)));
  });
});
