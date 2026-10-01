import { type DocPageId, type DocSpaceId, Identifiers } from "@loadbearing/contracts";
import { NotFoundError, ValidationError } from "@loadbearing/errors";
import { describe, expect, it } from "vitest";
import { DocRules } from "../../src/doc/doc.rules.js";
import type { DocPageNodeRecord } from "../../src/doc/doc-page.repository.js";

const SPACE: DocSpaceId = Identifiers.docSpaceId.parse("018f8c00-0000-7000-8000-000000000100");
const AUTHOR = Identifiers.userId.parse("018f8c00-0000-7000-8000-000000000200");
const OTHER = Identifiers.userId.parse("018f8c00-0000-7000-8000-000000000201");
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

  // `owner` is anyone's to choose, in a tenant as in the platform organization.
  it("allows `owner` in any organization", () => {
    expect(() => DocRules.assertAudience("owner", false)).not.toThrow();
    expect(() => DocRules.assertAudience("owner", true)).not.toThrow();
  });

  it("shows an owner space to its author and to nobody else", () => {
    const owned = { audience: "owner" as const, createdBy: AUTHOR };

    expect(DocRules.isVisible(owned, AUTHOR)).toBe(true);
    expect(DocRules.isVisible(owned, OTHER)).toBe(false);
    expect(DocRules.isVisible(owned, null)).toBe(false);
    expect(DocRules.isVisible({ audience: "members", createdBy: AUTHOR }, OTHER)).toBe(true);
  });

  // NOT_FOUND, never FORBIDDEN, and naming what was asked for: a page in someone else's
  // owner space is a page that does not exist.
  it("answers a hidden space as missing, under the resource the caller asked for", () => {
    const owned = { audience: "owner" as const, createdBy: AUTHOR };

    expect(() => DocRules.assertVisible(owned, OTHER, "doc.page", "p1")).toThrow(NotFoundError);
    expect(() => DocRules.assertVisible(null, AUTHOR, "doc.space", "s1")).toThrow(NotFoundError);
    expect(DocRules.assertVisible(owned, AUTHOR, "doc.space", "s1")).toBe(owned);
  });

  it("lets only the author make a space owner", () => {
    const members = { audience: "members" as const, createdBy: AUTHOR };

    expect(() => DocRules.assertAudienceChange(members, "owner", OTHER)).toThrow(ValidationError);
    expect(() => DocRules.assertAudienceChange(members, "owner", AUTHOR)).not.toThrow();
    expect(() => DocRules.assertAudienceChange(members, "members", OTHER)).not.toThrow();
  });

  it("refuses a grant on an owner space", () => {
    expect(() => DocRules.assertGrantable({ audience: "owner", createdBy: AUTHOR })).toThrow(
      ValidationError,
    );
    expect(() =>
      DocRules.assertGrantable({ audience: "granted", createdBy: AUTHOR }),
    ).not.toThrow();
  });

  it("refuses the space slugs the editor's own routes already spend", () => {
    expect(() => DocRules.assertSpaceSlug("edit")).toThrow(ValidationError);
    expect(() => DocRules.assertSpaceSlug("manage")).toThrow(ValidationError);
    expect(() => DocRules.assertSpaceSlug("guides")).not.toThrow();
  });
});

describe("DocRules.trimNav", () => {
  const leaf = (n: number, path: string) => ({
    id: id(n),
    kind: "page" as const,
    title: path,
    icon: null,
    path,
    url: null,
    revisionNo: 1,
    children: [],
  });
  const tree = [
    {
      id: id(1),
      kind: "section" as const,
      title: "Guides",
      icon: null,
      path: null,
      url: null,
      revisionNo: null,
      children: [
        { ...leaf(2, "a"), children: [{ ...leaf(3, "a/b"), children: [leaf(4, "a/b/c")] }] },
        { ...leaf(5, "d"), children: [leaf(6, "d/e")] },
      ],
    },
  ];

  // A section's pages are always drawn, so they stay; only closed branches fold.
  it("keeps sections and the reader's own branch, and folds every other branch", () => {
    const [section] = DocRules.trimNav(tree, id(4));
    const [a, d] = section?.children ?? [];
    expect(a?.children[0]?.children.map((node) => node.id)).toEqual([id(4)]);
    expect(d?.children).toEqual([]);
    expect(d?.folded).toBe(true);
  });

  it("folds every branch below the sections when no page is open", () => {
    const [section] = DocRules.trimNav(tree, null);
    expect(section?.children.every((node) => node.folded === true)).toBe(true);
  });
});
