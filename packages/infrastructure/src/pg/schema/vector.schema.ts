import {
  index,
  integer,
  jsonb,
  type OrganizationId,
  pgTable,
  primaryKey,
  sql,
  text,
  timestamp,
  uuid,
  vector,
} from "../../import.js";

// Partitioned by tenant and by nothing else. One HNSW graph per tenant is the better
// shape: `search()` carries the tenant, so a query walks one small graph.
export const documentChunks = pgTable(
  "document_chunks",
  {
    id: uuid("id").notNull(),
    // Routed, so no key to the catalog — decision `24.1`. A deleted tenant loses its
    // corpus with its partition, and the nightly orphan pass counts what is left.
    organizationId: uuid("organization_id").$type<OrganizationId>().notNull(),

    // The domain row this chunk was derived from — a document, receipt, note.
    sourceId: uuid("source_id").notNull(),
    sourceType: text("source_type").notNull(),

    // Null means org-wide *within this organization*, never across organizations.
    goalId: uuid("goal_id"),

    chunkIndex: integer("chunk_index").notNull(),
    content: text("content").notNull(),

    // Must match EMBEDDING_DIMENSIONS. Changing it is ALTER TABLE plus re-embedding
    // the whole corpus, which is why the value is in `.env.example`.
    embedding: vector("embedding", { dimensions: 1536 }).notNull(),

    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // The tenant is the partition key, so it is in the primary key — and `upsert`'s
    // conflict target has to name the same pair.
    primaryKey({ columns: [t.id, t.organizationId] }),
    index("document_chunks_source_idx").on(t.organizationId, t.sourceId),
    index("document_chunks_goal_idx").on(t.organizationId, t.goalId),
    // Partial index for the org-wide case, declared rather than left as a loose
    // `sql` template: drizzle-kit emits this one, so it actually gets created.
    index("document_chunks_goal_null_idx")
      .on(t.organizationId, t.id)
      .where(sql`${t.goalId} is null`),
    // HNSW, not IVFFlat: it builds incrementally, which matters when the table
    // starts empty. The operator class must match the query or it seq-scans.
    index("document_chunks_embedding_idx")
      .using("hnsw", t.embedding.op("vector_cosine_ops"))
      .with({ m: 16, ef_construction: 64 }),
  ],
);
