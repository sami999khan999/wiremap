import { Identifiers } from "@loadbearing/contracts";
import { Uuid } from "@loadbearing/core";
import { and, eq, type Logger } from "drizzle-orm";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "../../src/pg/primitive/index.js";
import { DatabaseCluster } from "../../src/pg/primitive/index.js";
import { PgVectorStore } from "../../src/pg/repository/pg-vector.store.js";
import { documentChunks, organizations } from "../../src/pg/schema/index.js";
import { ShardScope, TransactionScope } from "../../src/pg/transaction/index.js";
import { DATABASE_URL, openDatabase, seedOrganizationId, seedTenant } from "../support/database.js";

// One node, so nothing is ever placed: every repository here resolves to it.
const shards = new ShardScope();

// Routed repositories refuse to pick a pool with no shard in scope, which is the
// tripwire working. One node here, so entering it is the whole placement.
const placeOnTheOneNode = () => shards.enter({ key: "spec" as never, node: 0 });

// Both hooks, and registered first: vitest runs every `beforeAll` before any
// `beforeEach`, and a fixture built in one of those makes routed queries too.
beforeAll(placeOnTheOneNode);
beforeEach(placeOnTheOneNode);

// Captures the SQL the store actually issued, so the EXPLAIN below runs the query under
// test rather than a copy of it that can drift.
class RecordingLogger implements Logger {
  public last: { query: string; params: unknown[] } | null = null;

  public logQuery(query: string, params: unknown[]): void {
    this.last = { query, params };
  }
}

const recorder = new RecordingLogger();
let database: Database;
let store: PgVectorStore;

// A unit vector on one axis, plus a near neighbour and an orthogonal one. Cosine
// similarity is then 1, ~0.99, and 0 — enough to prove ordering and the floor.
const axis = (index: number): number[] =>
  Array.from({ length: 1536 }, (_, i) => (i === index ? 1 : 0));

const blend = (a: number, b: number): number[] =>
  Array.from({ length: 1536 }, (_, i) => (i === a ? 0.99 : i === b ? 0.14 : 0));

beforeAll(() => {
  database = openDatabase(recorder);
  store = new PgVectorStore(DatabaseCluster.single(database), new TransactionScope(), shards);
});

afterAll(async () => {
  await database.close();
});

const seedOrg = () => seedOrganizationId(database);

describe("PgVectorStore", () => {
  it("returns org-wide chunks only when the permitted scope is empty", async () => {
    const organizationId = await seedOrg();
    const sourceId = Uuid.v7();
    const goalId = Identifiers.goalId.parse(Uuid.v7());

    await store.upsert(organizationId, [
      {
        id: Uuid.v7(),
        sourceId,
        goalId: null,
        content: "org-wide chunk",
        embedding: axis(0),
        metadata: { chunkIndex: 0, sourceType: "note" },
      },
      {
        id: Uuid.v7(),
        sourceId,
        goalId,
        content: "goal-scoped chunk",
        embedding: axis(0),
        metadata: { chunkIndex: 1, sourceType: "note" },
      },
    ]);

    const withoutScope = await store.search(organizationId, axis(0), [], 10);
    expect(withoutScope.map((h) => h.content)).toEqual(["org-wide chunk"]);

    const withScope = await store.search(organizationId, axis(0), [goalId], 10);
    expect(withScope.map((h) => h.content).sort()).toEqual(["goal-scoped chunk", "org-wide chunk"]);

    await store.deleteBySource(organizationId, sourceId);
  });

  it("orders by similarity and drops everything under the floor", async () => {
    const organizationId = await seedOrg();
    const sourceId = Uuid.v7();

    await store.upsert(organizationId, [
      {
        id: Uuid.v7(),
        sourceId,
        goalId: null,
        content: "exact",
        embedding: axis(1),
        metadata: { chunkIndex: 0 },
      },
      {
        id: Uuid.v7(),
        sourceId,
        goalId: null,
        content: "near",
        embedding: blend(1, 2),
        metadata: { chunkIndex: 1 },
      },
      {
        id: Uuid.v7(),
        sourceId,
        goalId: null,
        content: "orthogonal",
        embedding: axis(3),
        metadata: { chunkIndex: 2 },
      },
    ]);

    const hits = await store.search(organizationId, axis(1), [], 10);

    // "orthogonal" scores 0, below MIN_SCORE, so the floor removes it entirely.
    expect(hits.map((h) => h.content)).toEqual(["exact", "near"]);
    expect(hits[0]?.score).toBeGreaterThan(hits[1]?.score ?? 1);

    await store.deleteBySource(organizationId, sourceId);
  });

  it("does not leak across organizations", async () => {
    const organizationId = await seedOrg();
    const otherOrg = Identifiers.organizationId.parse(Uuid.v7());
    const sourceId = Uuid.v7();

    await database.client
      .insert(organizations)
      .values({ id: otherOrg, slug: `other-${sourceId}`, name: "Other" });
    await seedTenant(database, otherOrg);

    await store.upsert(otherOrg, [
      {
        id: Uuid.v7(),
        sourceId,
        goalId: null,
        content: "other tenant chunk",
        embedding: axis(0),
        metadata: { chunkIndex: 0 },
      },
    ]);

    const hits = await store.search(organizationId, axis(0), [], 10);
    expect(hits.map((h) => h.content)).not.toContain("other tenant chunk");

    await store.deleteBySource(otherOrg, sourceId);
    await database.client.delete(organizations).where(eq(organizations.id, otherOrg));
  });

  // `ORDER BY (1 - (embedding <=> $1)) DESC` is an expression no HNSW index can serve.
  // See docs/reference/pgvector.md for why the assertion is on the shape.
  it("orders on the distance operator, in the shape the HNSW index can serve", async () => {
    const organizationId = await seedOrg();
    const sourceId = Uuid.v7();

    await store.upsert(
      organizationId,
      Array.from({ length: 32 }, (_, i) => ({
        id: Uuid.v7(),
        sourceId,
        goalId: null,
        content: `chunk ${i}`,
        embedding: axis(i),
        metadata: { chunkIndex: i },
      })),
    );

    await store.search(organizationId, axis(0), [], 10);

    const issued = recorder.last;
    if (!issued) throw new Error("expected the search above to have been logged");

    // Ascending on the bare operator, and no inversion anywhere in the ordering.
    const ordering = /order by\s+"\w+"\."embedding"\s*<=>\s*\$\d+\s+asc/i;
    expect(issued.query).toMatch(ordering);
    expect(issued.query).not.toMatch(/order by[\s\S]*desc/i);
    expect(issued.query).not.toMatch(/order by[\s\S]*1 -/i);

    // And the plan agrees: the sort key is the operator, not an expression over it.
    const pool = new Pool({ connectionString: DATABASE_URL });
    const client = await pool.connect();

    try {
      const explained = await client.query(`explain ${issued.query}`, issued.params);
      const plan = explained.rows.map((row) => Object.values(row).join(" ")).join(" | ");
      // The qualifier is optional: the scan is on the tenant's partition under an alias
      // since `0023`, so the plan reads `document_chunks.embedding` rather than bare.
      const sortKey = /Sort Key: \(\((?:\w+\.)?embedding <=> [^)]*\)\)/.test(plan);

      // And the index name is generated on the partition, so the suffix is what is
      // stable — one HNSW graph per tenant, which is the better shape here.
      expect(sortKey || plan.includes("_embedding_idx")).toBe(true);
    } finally {
      client.release();
      await pool.end();
      await store.deleteBySource(organizationId, sourceId);
    }
  });

  it("upsert replaces content for an existing id", async () => {
    const organizationId = await seedOrg();
    const sourceId = Uuid.v7();
    const id = Uuid.v7();

    const chunk = {
      id,
      sourceId,
      goalId: null,
      content: "first",
      embedding: axis(5),
      metadata: { chunkIndex: 0 },
    };

    await store.upsert(organizationId, [chunk]);
    await store.upsert(organizationId, [{ ...chunk, content: "second" }]);

    const rows = await database.client
      .select({ content: documentChunks.content })
      .from(documentChunks)
      .where(and(eq(documentChunks.id, id), eq(documentChunks.organizationId, organizationId)));

    expect(rows).toEqual([{ content: "second" }]);

    await store.deleteBySource(organizationId, sourceId);
  });

  // `CR.8` and `CR.33` read these two off one chunk: where the source sits, and which
  // request wrote it. A chunk from before versions reads as null, never as zero.
  it("answers where a source is indexed and at which version", async () => {
    const organizationId = await seedOrg();
    const sourceId = Uuid.v7();
    const goalId = Identifiers.goalId.parse(Uuid.v7());
    const chunk = (version?: number) => ({
      id: Uuid.v7(),
      sourceId,
      goalId,
      content: "versioned",
      embedding: axis(6),
      metadata: { chunkIndex: 0, ...(version === undefined ? {} : { version }) },
    });

    expect(await store.sourceOf(organizationId, sourceId)).toBeNull();

    await store.upsert(organizationId, [chunk()]);
    expect(await store.sourceOf(organizationId, sourceId)).toEqual({ goalId, version: null });

    await store.deleteBySource(organizationId, sourceId);
    await store.upsert(organizationId, [chunk(1_790_000_000_000)]);
    expect(await store.sourceOf(organizationId, sourceId)).toEqual({
      goalId,
      version: 1_790_000_000_000,
    });

    await store.deleteBySource(organizationId, sourceId);
  });
});
