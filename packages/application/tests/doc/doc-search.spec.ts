import { type DocNavNodeDto, Identifiers } from "@loadbearing/contracts";
import { CapabilitySet } from "@loadbearing/permissions";
import { describe, expect, it } from "vitest";
import type { DocCache } from "../../src/doc/doc.cache.js";
import { DocFeaturePolicy } from "../../src/doc/doc-feature.policy.js";
import type { DocPageRepository, DocSearchMatch } from "../../src/doc/doc-page.repository.js";
import { DocSearch } from "../../src/doc/doc-search.js";
import type { DocSpaceRecord, DocSpaceSummary } from "../../src/doc/doc-space.repository.js";
import type { FlagCache } from "../../src/flag/index.js";
import type { EntitlementRepository } from "../../src/platform/index.js";
import type { CacheStore } from "../../src/port/index.js";
import { Principal } from "../../src/primitive/principal.js";

const ORG = Identifiers.organizationId.parse("018f8c00-0000-7000-8000-000000000010");
const USER = Identifiers.userId.parse("018f8c00-0000-7000-8000-000000000011");
const id = (n: number) => `018f8c00-0000-7000-8000-${String(n).padStart(12, "0")}`;

const leaf = (n: number, path: string, linked = false): DocNavNodeDto => ({
  id: Identifiers.docPageId.parse(id(n)),
  kind: "page",
  title: path,
  icon: null,
  path,
  url: null,
  revisionNo: 1,
  children: [],
  ...(linked
    ? { access: { module: null, permission: "rbac.role.manage", flag: null, plan: null } }
    : {}),
});

const space = (n: number, slug: string, nav: DocNavNodeDto[]) =>
  ({
    id: Identifiers.docSpaceId.parse(id(n)),
    organizationId: ORG,
    slug,
    title: slug.toUpperCase(),
    access: null,
    nav,
  }) as unknown as DocSpaceRecord;

const guide = space(100, "guide", [leaf(1, "install")]);
const api = space(200, "api", [leaf(2, "keys"), leaf(3, "admin", true)]);
const other = space(300, "other", [leaf(4, "secret")]);

const match = (page: number, spaceId: number): DocSearchMatch => ({
  pageId: Identifiers.docPageId.parse(id(page)),
  spaceId: Identifiers.docSpaceId.parse(id(spaceId)),
  anchor: null,
  heading: null,
  excerpt: "",
  rank: 1,
});

const noCache = {} as CacheStore;
const search = () => {
  const pages = {
    search: () => Promise.resolve([match(1, 100), match(2, 200), match(3, 200), match(4, 300)]),
  } as unknown as DocPageRepository;
  const cache = {
    space: (_org: unknown, slug: string) =>
      Promise.resolve([guide, api, other].find((each) => each.slug === slug) ?? null),
  } as unknown as DocCache;
  const features = new DocFeaturePolicy({} as FlagCache, {} as EntitlementRepository, noCache);
  return { features, search: new DocSearch(pages, cache, features) };
};

const reader = new Principal(
  ORG,
  USER,
  CapabilitySet.from({
    wildcard: false,
    org: { grants: ["doc.page.read"], denies: [] },
    goals: {},
  }),
);

describe("DocSearch across the whole docs", () => {
  // Every readable space at once, and nothing from a space the caller did not allow, nor a
  // page whose feature the reader lacks.
  it("finds hits in every allowed space and drops the rest", async () => {
    const { features, search: docs } = search();
    const allowed = [guide, api] as unknown as DocSpaceSummary[];
    const hits = await docs.run(ORG, "x", allowed, 10, features.scope(reader));
    expect(hits.map((hit) => `${hit.spaceSlug}/${hit.path}`)).toEqual([
      "guide/install",
      "api/keys",
    ]);
  });
});
