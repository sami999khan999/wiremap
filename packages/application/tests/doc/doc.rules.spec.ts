import { type DocPageId, type DocSpaceId, Identifiers } from "@loadbearing/contracts";
import { ValidationError } from "@loadbearing/errors";
import { describe, expect, it } from "vitest";
import { DocRules } from "../../src/doc/doc.rules.js";
import type { DocPageNodeRecord } from "../../src/doc/doc-page.repository.js";

const SPACE: DocSpaceId = Identifiers.docSpaceId.parse("018f8c00-0000-7000-8000-000000000100");
const id = (n: number): DocPageId =>
  Identifiers.docPageId.parse(`018f8c00-0000-7000-8000-${String(n).padStart(12, "0")}`);

const node = (
  n: number,
  overrides: Partial<DocPageNodeRecord> & Pick<DocPageNodeRecord, "slug">,
): DocPageNodeRecord => ({
  id: id(n),
  spaceId: SPACE,
  parentId: null,
  kind: "page",
  title: overrides.slug,
  icon: null,
  url: null,
  position: n,
  draftVersion: 1,
  publishedDraftVersion: 1,
  publishedTitle: overrides.slug.toUpperCase(),
  revisionNo: 1,
  publishedAt: new Date(0),
  updatedAt: new Date(0),
  ...overrides,
});

describe("DocRules", () => {
  it("derives the status from the two versions rather than storing it", () => {
    expect(DocRules.status(node(1, { slug: "a", publishedDraftVersion: null }))).toBe("draft");
    expect(DocRules.status(node(1, { slug: "a" }))).toBe("published");
    expect(DocRules.status(node(1, { slug: "a", draftVersion: 3, publishedDraftVersion: 2 }))).toBe(
      "changed",
    );
  });

  it("builds paths through pages and never through sections", () => {
    const nav = DocRules.buildNav([
      node(1, { slug: "intro", kind: "section" }),
      node(2, { slug: "quick-start", parentId: id(1) }),
      node(3, { slug: "guides" }),
      node(4, { slug: "writing", parentId: id(3) }),
    ]);

    expect(nav.map((entry) => entry.kind)).toEqual(["section", "page"]);
    expect(nav[0]?.children[0]?.path).toBe("quick-start");
    expect(nav[1]?.children[0]?.path).toBe("guides/writing");
    // The reader sees the published title, never the draft one.
    expect(nav[0]?.children[0]?.title).toBe("QUICK-START");
  });

  // Its children's paths run through it, so they cannot be reached until it is published.
  it("drops an unpublished page with everything under it, and a section left empty", () => {
    const nav = DocRules.buildNav([
      node(1, { slug: "empty", kind: "section" }),
      node(2, { slug: "draft", parentId: id(1), publishedDraftVersion: null }),
      node(3, { slug: "child", parentId: id(2) }),
      node(4, { slug: "live" }),
    ]);

    expect(nav.map((entry) => entry.path)).toEqual(["live"]);
  });

  it("opens a space at the first page in reading order and finds the rest by path", () => {
    const nav = DocRules.buildNav([
      node(1, { slug: "outside", kind: "link", url: "https://example.com" }),
      node(2, { slug: "first" }),
      node(3, { slug: "second" }),
    ]);

    expect(DocRules.find(nav, "")?.path).toBe("first");
    expect(DocRules.find(nav, "/second/")?.path).toBe("second");
    expect(DocRules.find(nav, "nowhere")).toBeNull();
  });

  it("refuses two pages whose paths collide across sections", () => {
    const nodes = [
      node(1, { slug: "a", kind: "section" }),
      node(2, { slug: "b", kind: "section" }),
      node(3, { slug: "same", parentId: id(1) }),
      node(4, { slug: "same", parentId: id(2) }),
    ];

    expect(() => DocRules.assertTree(nodes)).toThrow(ValidationError);
  });

  it("refuses a cycle, a missing parent and a child under a link", () => {
    const cycle = [
      node(1, { slug: "a", parentId: id(2) }),
      node(2, { slug: "b", parentId: id(1) }),
    ];
    const orphan = [node(1, { slug: "a", parentId: id(9) })];
    const underLink = [
      node(1, { slug: "out", kind: "link", url: "https://example.com" }),
      node(2, { slug: "in", parentId: id(1) }),
    ];

    for (const nodes of [cycle, orphan, underLink]) {
      expect(() => DocRules.assertTree(nodes)).toThrow(ValidationError);
    }
  });

  it("names the page first and then everything under it", () => {
    const nodes = [
      node(1, { slug: "root" }),
      node(2, { slug: "child", parentId: id(1) }),
      node(3, { slug: "grandchild", parentId: id(2) }),
      node(4, { slug: "sibling" }),
    ];

    expect(DocRules.subtree(nodes, id(1))).toEqual([id(1), id(2), id(3)]);
  });

  it("keeps `public` and `granted` for the platform organization", () => {
    expect(() => DocRules.assertAudience("public", false)).toThrow(ValidationError);
    expect(() => DocRules.assertAudience("granted", false)).toThrow(ValidationError);
    expect(() => DocRules.assertAudience("members", false)).not.toThrow();
    expect(() => DocRules.assertAudience("public", true)).not.toThrow();
  });

  it("refuses the space slugs the editor's own routes already spend", () => {
    expect(() => DocRules.assertSpaceSlug("edit")).toThrow(ValidationError);
    expect(() => DocRules.assertSpaceSlug("manage")).toThrow(ValidationError);
    expect(() => DocRules.assertSpaceSlug("guides")).not.toThrow();
  });
});
