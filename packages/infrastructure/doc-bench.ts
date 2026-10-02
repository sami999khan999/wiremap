// `pnpm doc:bench`: seeds a public 2,000-page platform space and measures it against a
// running web server. The budgets it is read against: docs/plans/DOCS-SYSTEM-PLAN.md `DS0.2`.

import { gzipSync } from "node:zlib";
import {
  type DocPageId,
  type DocPageNodeRecord,
  DocRules,
  type DocSpaceId,
  eq,
  Identifiers,
  sql,
  type UserId,
  Uuid,
} from "./src/import.js";
import { Database, DatabaseCluster } from "./src/pg/primitive/index.js";
import { PgDocPageRepository } from "./src/pg/repository/index.js";
import { docPages, docSections, docSpaces, organizations } from "./src/pg/schema/index.js";
import { ShardScope, TransactionScope } from "./src/pg/transaction/index.js";
import { UnifiedMarkdownRenderer } from "./src/unified/index.js";

const url = process.env.DATABASE_DIRECT_URL ?? process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_DIRECT_URL or DATABASE_URL is required.");
const base = process.env.BENCH_URL ?? "http://localhost:43000";

const SLUG = "bench";
const PAGES = 2_000;
const LARGE = 20;
const LARGE_CHARS = 195_000;

// ── content ──────────────────────────────────────────────────────────────────

const paragraph = (seed: number) =>
  `Loadbearing keeps every tenant's rows apart, and section ${seed} explains how a request ` +
  `finds its node, opens a transaction and reads one row for the page it renders.\n\n`;

const page = (index: number) =>
  Array.from(
    { length: 6 },
    (_, h) => `## Topic ${index}.${h}\n\n${paragraph(index)}${paragraph(index + h)}`,
  ).join("");

// At the 200,000-character cap, with 300 code blocks: the page the budgets are about.
const large = (index: number) => {
  const parts: string[] = [];
  let length = 0;
  for (let block = 0; length < LARGE_CHARS; block += 1) {
    const part =
      `## Part ${index}.${block}\n\n${paragraph(block)}` +
      (block % 2 === 0 ? "```ts\nconst value = await container.read(id);\n```\n\n" : "");
    parts.push(part);
    length += part.length;
  }
  return parts.join("").slice(0, LARGE_CHARS);
};

// ── seed ─────────────────────────────────────────────────────────────────────

const database = new Database({ url });
const renderer = new UnifiedMarkdownRenderer();

const [platform] = await database.client
  .select({ id: organizations.id })
  .from(organizations)
  .where(eq(organizations.isPlatform, true))
  .limit(1);
if (!platform) throw new Error("run `pnpm db:seed` first: no platform organization");
const organizationId = platform.id;
const author = Identifiers.userId.parse(Uuid.v7()) as UserId;

const old = await database.client
  .select({ id: docSpaces.id })
  .from(docSpaces)
  .where(sql`${docSpaces.organizationId} = ${organizationId} and ${docSpaces.slug} = ${SLUG}`);
for (const row of old) {
  await database.client.delete(docSections).where(eq(docSections.spaceId, row.id));
  await database.client.delete(docPages).where(eq(docPages.spaceId, row.id));
  await database.client.delete(docSpaces).where(eq(docSpaces.id, row.id));
}

const spaceId = Uuid.v7() as DocSpaceId;
await database.client.insert(docSpaces).values({
  id: spaceId,
  organizationId,
  slug: SLUG,
  title: "Bench",
  description: "A large space the benchmark reads.",
  audience: "public",
  createdBy: author,
});

// Ten sections, each a tree of pages four levels deep: wide enough to fill a sidebar,
// deep enough to exercise path resolution.
const nodes: DocPageNodeRecord[] = [];
const rows: (typeof docPages.$inferInsert)[] = [];
const sections: (typeof docSections.$inferInsert)[] = [];
const renderTimes: number[] = [];
const now = new Date();

const add = (parentId: DocPageId | null, kind: "section" | "page", index: number) => {
  const id = Uuid.v7() as DocPageId;
  const record: DocPageNodeRecord = {
    id,
    spaceId,
    parentId,
    kind,
    slug: `${kind}-${index}`,
    title: kind === "section" ? `Section ${index}` : `Page ${index}`,
    icon: null,
    url: null,
    access: null,
    position: index,
    draftVersion: 1,
    publishedDraftVersion: kind === "page" ? 1 : null,
    publishedTitle: kind === "page" ? `Page ${index}` : null,
    revisionNo: kind === "page" ? 1 : 0,
    publishedAt: kind === "page" ? now : null,
    updatedAt: now,
  };
  nodes.push(record);
  return record;
};

let made = 0;
for (let s = 0; s < 10; s += 1) {
  const section = add(null, "section", s);
  const parents: DocPageId[] = [section.id];
  while (made < (PAGES * (s + 1)) / 10) {
    const depth = made % 4;
    const parentId = parents[Math.min(depth, parents.length - 1)] ?? section.id;
    const child = add(parentId, "page", made);
    if (parents.length < 4) parents.push(child.id);
    else parents[depth + 1 < 4 ? depth + 1 : 3] = child.id;
    made += 1;
  }
}

// The last pages in reading order are the large ones, so the reader's largest case is a
// real path rather than a page nothing links to.
const pageIds = nodes.filter((node) => node.kind === "page").map((node) => node.id);
const largeIds = new Set(pageIds.slice(-LARGE));

for (const node of nodes) {
  const markdown =
    node.kind === "section"
      ? ""
      : largeIds.has(node.id)
        ? large(node.position)
        : page(node.position);
  let html = null;
  let toc = null;
  if (node.kind === "page") {
    const started = performance.now();
    const rendered = await renderer.render(markdown);
    renderTimes.push(performance.now() - started);
    html = rendered.html;
    toc = rendered.toc;
    rendered.sections.forEach((section, position) => {
      sections.push({
        id: Uuid.v7(),
        organizationId,
        spaceId,
        pageId: node.id,
        position,
        anchor: section.anchor,
        heading: section.heading,
        body: section.body,
      });
    });
  }
  rows.push({
    id: node.id,
    organizationId,
    spaceId,
    parentId: node.parentId,
    kind: node.kind,
    slug: node.slug,
    position: node.position,
    title: node.title,
    markdown,
    updatedBy: author,
    publishedTitle: node.publishedTitle,
    publishedMarkdown: node.kind === "page" ? markdown : null,
    publishedHtml: html,
    publishedToc: toc,
    publishedDraftVersion: node.publishedDraftVersion,
    publishedBy: node.kind === "page" ? author : null,
    publishedAt: node.publishedAt,
    revisionNo: node.revisionNo,
    rendererVersion: node.kind === "page" ? renderer.version : null,
    createdBy: author,
  });
}

for (let at = 0; at < rows.length; at += 200) {
  await database.client.insert(docPages).values(rows.slice(at, at + 200));
}
for (let at = 0; at < sections.length; at += 1_000) {
  await database.client.insert(docSections).values(sections.slice(at, at + 1_000));
}
const nav = DocRules.buildNav(nodes);
await database.client
  .update(docSpaces)
  .set({ nav, version: 1 })
  .where(sql`${docSpaces.id} = ${spaceId} and ${docSpaces.organizationId} = ${organizationId}`);

// ── measure ──────────────────────────────────────────────────────────────────

const quantile = (values: readonly number[], q: number) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0;
};
const statements = async () =>
  Number(
    (
      await database.client.execute<{ calls: string }>(
        sql`select coalesce(sum(calls), 0) as calls from pg_stat_statements
            where query not ilike '%pg_stat_statements%'`,
      )
    ).rows[0]?.calls ?? 0,
  );

// Closed-loop load: `concurrency` callers, each requesting back to back.
const load = async (paths: readonly string[], concurrency: number, seconds: number) => {
  const end = Date.now() + seconds * 1000;
  const times: number[] = [];
  let failed = 0;
  let next = 0;
  await database.client.execute(sql`select pg_stat_statements_reset()`);
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (Date.now() < end) {
        const path = paths[next++ % paths.length] ?? "/";
        const started = performance.now();
        const response = await fetch(`${base}${path}`).catch(() => null);
        if (!response?.ok) failed += 1;
        await response?.arrayBuffer();
        times.push(performance.now() - started);
      }
    }),
  );
  const calls = await statements();
  return {
    rps: Math.round(times.length / seconds),
    p50: Math.round(quantile(times, 0.5)),
    p95: Math.round(quantile(times, 0.95)),
    queriesPerRequest: Number((calls / Math.max(1, times.length)).toFixed(2)),
    failed,
  };
};

const pagePaths: string[] = [];
const walk = (list: readonly (typeof nav)[number][]) => {
  for (const node of list) {
    if (node.path) pagePaths.push(node.path);
    walk(node.children);
  }
};
walk(nav);
const lastLarge = nodes.find((node) => node.id === pageIds[pageIds.length - 1]);
const largePath = pagePaths.find((path) => path.endsWith(lastLarge?.slug ?? "")) ?? pagePaths[0];

const navJson = JSON.stringify(nav);
const shards = new ShardScope();
const repository = new PgDocPageRepository(
  DatabaseCluster.single(database),
  new TransactionScope(),
  shards,
);
const searchTimes: number[] = [];
for (const term of ["tenant", "transaction", "section 12", "node", "page renders"]) {
  for (let round = 0; round < 20; round += 1) {
    const started = performance.now();
    await shards.atNode(0, () => repository.search(organizationId, term, 10));
    searchTimes.push(performance.now() - started);
  }
}

const report = {
  seeded: { pages: pagePaths.length, sections: sections.length },
  render: {
    p95Ms: Math.round(quantile(renderTimes, 0.95)),
    maxMs: Math.round(Math.max(...renderTimes)),
  },
  nav: { bytes: navJson.length, gzipBytes: gzipSync(navJson).length },
  search: {
    p50Ms: Math.round(quantile(searchTimes, 0.5)),
    p95Ms: Math.round(quantile(searchTimes, 0.95)),
  },
  readerCold: await load(
    pagePaths.slice(0, 400).map((path) => `/docs/${SLUG}/${path}`),
    20,
    10,
  ),
  readerWarm: await load([`/docs/${SLUG}/${pagePaths[0]}`], 20, 10),
  readerLargest: await load([`/docs/${SLUG}/${largePath}`], 10, 10),
  rawMarkdown: await load([`/api/doc/${SLUG}/${pagePaths[0]}`], 20, 10),
};

console.log(JSON.stringify(report, null, 2));
await database.close();
