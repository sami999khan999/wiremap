import {
  type DocPageId,
  type DocSpaceId,
  Identifiers,
  type OrganizationId,
} from "@loadbearing/contracts";
import { Uuid } from "@loadbearing/core";
import { type Logger, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Database, DatabaseCluster } from "../../src/pg/primitive/index.js";
import { PgDocPageRepository } from "../../src/pg/repository/pg-doc-page.repository.js";
import { PgDocSpaceRepository } from "../../src/pg/repository/pg-doc-space.repository.js";
import { ShardScope, TransactionScope } from "../../src/pg/transaction/index.js";
import { DATABASE_URL, openDatabase, seedOrganizationId } from "../support/database.js";

// One node, so nothing is ever placed: every repository here resolves to it.
const shards = new ShardScope();
const placeOnTheOneNode = () => shards.enter({ key: "spec" as never, node: 0 });

beforeAll(placeOnTheOneNode);
beforeEach(placeOnTheOneNode);

class CountingLogger implements Logger {
  public count = 0;
  public logQuery(): void {
    this.count += 1;
  }
}

const counter = new CountingLogger();
let database: Database;
let counted: Database;
let organizationId: OrganizationId;

const author = Identifiers.userId.parse(Uuid.v7());
const spaceId = Identifiers.docSpaceId.parse(Uuid.v7()) as DocSpaceId;
const page = (): DocPageId => Identifiers.docPageId.parse(Uuid.v7());

const spaces = (db: Database = database) =>
  new PgDocSpaceRepository(DatabaseCluster.single(db), new TransactionScope(), shards);
const pages = (db: Database = database) =>
  new PgDocPageRepository(DatabaseCluster.single(db), new TransactionScope(), shards);

const PUBLICATION = {
  title: "Quick Start",
  description: "Getting started",
  markdown: "## Install\n\nRun it.",
  html: '<h2 id="install">Install</h2><p>Run it.</p>',
  toc: [{ id: "install", text: "Install", depth: 2 }],
  rendererVersion: 1,
};

beforeAll(async () => {
  database = openDatabase();
  counted = new Database({ url: DATABASE_URL, logger: counter });
  organizationId = await seedOrganizationId(database);
  const created = await spaces().create(
    organizationId,
    spaceId,
    {
      slug: `spec-${spaceId.slice(-12)}`,
      title: "Spec",
      description: null,
      icon: null,
      audience: "members",
      theme: null,
      access: null,
      repositoryUrl: null,
    },
    author,
  );
  expect(created).toBe(true);
});

afterAll(async () => {
  await pages().deleteBySpace(organizationId, spaceId);
  await spaces().delete(organizationId, spaceId);
  await counted.close();
  await database.close();
});

const newPage = async (slug: string, parentId: DocPageId | null = null) => {
  const id = page();
  await pages().create(organizationId, {
    id,
    spaceId,
    parentId,
    kind: "page",
    slug,
    title: slug,
    icon: null,
    url: null,
    position: 0,
    createdBy: author,
  });
  return id;
};

describe("PgDocSpaceRepository", () => {
  it("refuses a second space with the same slug in the same tenant", async () => {
    const taken = await spaces().findById(organizationId, spaceId);
    const again = await spaces().create(
      organizationId,
      Identifiers.docSpaceId.parse(Uuid.v7()),
      { ...(taken as NonNullable<typeof taken>), description: null },
      author,
    );
    expect(again).toBe(false);
  });

  it("bumps the version every time the tree is replaced", async () => {
    const before = (await spaces().findById(organizationId, spaceId))?.version ?? 0;
    const after = await spaces().saveNav(organizationId, spaceId, []);
    expect(after).toBe(before + 1);
  });
});

describe("PgDocPageRepository", () => {
  it("saves a draft only at the version the editor read", async () => {
    const id = await newPage(`draft-${Uuid.v7().slice(-8)}`);
    const fields = {
      slug: "x",
      title: "X",
      description: null,
      icon: null,
      markdown: "one",
      url: null,
      access: null,
    };

    expect(await pages().saveDraft(organizationId, id, 1, fields, author)).toBe(true);
    // The second editor still holds version 1, which is now stale.
    expect(
      await pages().saveDraft(organizationId, id, 1, { ...fields, markdown: "two" }, author),
    ).toBe(false);
    expect((await pages().findDraft(organizationId, id))?.markdown).toBe("one");
  });

  // jsonb in, the same rule out, and on the node the tree is built from.
  it("stores a page's access rule and reads it back on its node", async () => {
    const id = await newPage(`access-${Uuid.v7().slice(-8)}`);
    const access = { module: "apikey", permission: null, flag: null, plan: "team" };
    const fields = {
      slug: "y",
      title: "Y",
      description: null,
      icon: null,
      markdown: "",
      url: null,
      access,
    };
    expect(await pages().saveDraft(organizationId, id, 1, fields, author)).toBe(true);

    expect((await pages().findDraft(organizationId, id))?.access).toEqual(access);
    const nodes = await pages().listBySpace(organizationId, spaceId);
    expect(nodes.find((node) => node.id === id)?.access).toEqual(access);
  });

  it("publishes under the same lock and counts revisions on the row", async () => {
    const id = await newPage(`pub-${Uuid.v7().slice(-8)}`);

    expect(await pages().publish(organizationId, id, 1, PUBLICATION, author)).toBe(1);
    expect(await pages().publish(organizationId, id, 1, PUBLICATION, author)).toBe(2);
    expect(await pages().publish(organizationId, id, 9, PUBLICATION, author)).toBeNull();

    const published = await pages().findPublished(organizationId, id);
    expect(published?.revisionNo).toBe(2);
    expect(published?.html).toBe(PUBLICATION.html);
    expect(published?.toc).toEqual(PUBLICATION.toc);

    const node = (await pages().listBySpace(organizationId, spaceId)).find((row) => row.id === id);
    expect(node?.publishedDraftVersion).toBe(1);
  });

  it("reads nothing published for a page that never was", async () => {
    const id = await newPage(`never-${Uuid.v7().slice(-8)}`);
    expect(await pages().findPublished(organizationId, id)).toBeNull();
  });

  it("keeps revisions newest first and finds one by number", async () => {
    const id = await newPage(`rev-${Uuid.v7().slice(-8)}`);
    for (const revisionNo of [1, 2, 3]) {
      await pages().saveRevision(
        organizationId,
        spaceId,
        id,
        revisionNo,
        { ...PUBLICATION, markdown: `v${revisionNo}` },
        author,
      );
    }

    const list = await pages().listRevisions(organizationId, id);
    expect(list.map((entry) => entry.revisionNo)).toEqual([3, 2, 1]);
    expect((await pages().findRevision(organizationId, id, 2))?.markdown).toBe("v2");
  });

  // A fixed count whatever the page's length or the number of siblings: an N+1 here is
  // invisible at five rows and a timeout at five hundred.
  it("replaces a page's sections and reorders siblings in a fixed number of statements", async () => {
    const parent = await newPage(`parent-${Uuid.v7().slice(-8)}`);
    const children = [
      await newPage("c-one", parent),
      await newPage("c-two", parent),
      await newPage("c-three", parent),
    ];
    const sections = Array.from({ length: 25 }, (_, n) => ({
      anchor: `h-${n}`,
      heading: `Heading ${n}`,
      body: `Body ${n}`,
    }));

    counter.count = 0;
    await pages(counted).saveSections(organizationId, spaceId, parent, sections);
    expect(counter.count).toBe(2);

    const reversed = [...children].reverse();
    counter.count = 0;
    await pages(counted).saveOrder(organizationId, parent, reversed);
    expect(counter.count).toBe(1);

    const order = (await pages().listBySpace(organizationId, spaceId))
      .filter((row) => row.parentId === parent)
      .sort((a, b) => a.position - b.position)
      .map((row) => row.id);
    expect(order).toEqual(reversed);
  });

  it("finds a section by a word in its body through the generated search column", async () => {
    const id = await newPage(`search-${Uuid.v7().slice(-8)}`);
    const word = `zebra${Uuid.v7().replace(/-/g, "").slice(-8)}`;
    await pages().saveSections(organizationId, spaceId, id, [
      { anchor: "one", heading: "One", body: `the ${word} runs` },
    ]);

    const result = await database.client.execute<{ anchor: string }>(
      sql`select anchor from doc_sections where organization_id = ${organizationId} and search @@ plainto_tsquery('simple', ${word})`,
    );
    expect(result.rows.map((row) => row.anchor)).toEqual(["one"]);
  });

  it("searches the text by word and the published titles by typo, in one statement", async () => {
    const id = await newPage(`find-${Uuid.v7().slice(-8)}`);
    const title = `Quokkaflux ${Uuid.v7().replace(/-/g, "").slice(-6)}`;
    const word = `wombat${Uuid.v7().replace(/-/g, "").slice(-8)}`;
    await pages().publish(organizationId, id, 1, { ...PUBLICATION, title }, author);
    await pages().saveSections(organizationId, spaceId, id, [
      { anchor: "setup", heading: "Setup", body: `feed the ${word} daily` },
    ]);

    counter.count = 0;
    const byWord = await pages(counted).search(organizationId, word, 5);
    expect(counter.count).toBe(1);
    expect(byWord.map((match) => [match.pageId, match.anchor])).toContainEqual([id, "setup"]);
    expect(byWord.find((match) => match.anchor === "setup")?.excerpt).toContain(word);

    // Half a word, as the palette sees it while it is still being typed.
    const byPrefix = await pages().search(organizationId, word.slice(0, 9), 5);
    expect(byPrefix.map((match) => match.anchor)).toContain("setup");

    // A letter dropped and one doubled, which full-text search would never match.
    const byTypo = await pages().search(organizationId, "quokaflux", 5);
    expect(byTypo.map((match) => match.pageId)).toContain(id);
  });

  it("deletes a subtree with its revisions and sections", async () => {
    const root = await newPage(`gone-${Uuid.v7().slice(-8)}`);
    const child = await newPage("gone-child", root);
    await pages().saveRevision(organizationId, spaceId, child, 1, PUBLICATION, author);
    await pages().saveSections(organizationId, spaceId, child, [
      { anchor: null, heading: null, body: "x" },
    ]);

    await pages().delete(organizationId, [root, child]);

    expect(await pages().findDraft(organizationId, root)).toBeNull();
    expect(await pages().findDraft(organizationId, child)).toBeNull();
    expect(await pages().listRevisions(organizationId, child)).toEqual([]);
  });
});
