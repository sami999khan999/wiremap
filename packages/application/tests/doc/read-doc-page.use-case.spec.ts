import { type DocNavNodeDto, Identifiers } from "@loadbearing/contracts";
import { NotFoundError } from "@loadbearing/errors";
import { CapabilitySet, type PermissionKey } from "@loadbearing/permissions";
import { describe, expect, it } from "vitest";
import { DocCache } from "../../src/doc/doc.cache.js";
import { DocFeaturePolicy } from "../../src/doc/doc-feature.policy.js";
import type { DocPageRepository } from "../../src/doc/doc-page.repository.js";
import type { DocSpaceRecord, DocSpaceRepository } from "../../src/doc/doc-space.repository.js";
import { ReadDocPageUseCase } from "../../src/doc/read-doc-page.use-case.js";
import type { FlagCache } from "../../src/flag/index.js";
import type { EntitlementRepository } from "../../src/platform/index.js";
import type { CacheStore } from "../../src/port/index.js";
import { Authorizer } from "../../src/primitive/authorizer.js";
import { Principal } from "../../src/primitive/principal.js";

const ORG = Identifiers.organizationId.parse("018f8c00-0000-7000-8000-000000000010");
const USER = Identifiers.userId.parse("018f8c00-0000-7000-8000-000000000011");
const pageId = (n: number) =>
  Identifiers.docPageId.parse(`018f8c00-0000-7000-8000-${String(n).padStart(12, "0")}`);

const holding = (...grants: readonly PermissionKey[]) =>
  new Principal(
    ORG,
    USER,
    CapabilitySet.from({ wildcard: false, org: { grants: [...grants], denies: [] }, goals: {} }),
  );

const node = (n: number, path: string, linked: boolean): DocNavNodeDto => ({
  id: pageId(n),
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

const space = {
  id: Identifiers.docSpaceId.parse("018f8c00-0000-7000-8000-000000000030"),
  organizationId: ORG,
  slug: "guide",
  title: "Guide",
  audience: "members",
  createdBy: USER,
  access: null,
  updatedAt: new Date(0),
  version: 1,
  nav: [node(1, "start", false), node(2, "admins", true)],
} as unknown as DocSpaceRecord;

const noCache: CacheStore = {
  get: () => Promise.resolve(null),
  set: () => Promise.resolve(),
  setIfAbsent: () => Promise.resolve(true),
  delete: () => Promise.resolve(),
  deletePrefix: () => Promise.resolve(),
};

const useCase = () => {
  const spaces = { findBySlug: () => Promise.resolve(space) } as unknown as DocSpaceRepository;
  const pages = {
    findPublished: (_org: unknown, id: string) =>
      Promise.resolve({ id, revisionNo: 1, publishedAt: new Date(0), html: "<p/>" }),
  } as unknown as DocPageRepository;
  const features = new DocFeaturePolicy({} as FlagCache, {} as EntitlementRepository, noCache);
  return new ReadDocPageUseCase(new Authorizer(), new DocCache(noCache, spaces, pages), features);
};

describe("ReadDocPageUseCase — access links", () => {
  // Not FORBIDDEN: a linked page must not be found by asking for it, as a private space is.
  it("answers NOT_FOUND for a page whose permission the reader lacks", async () => {
    await expect(
      useCase().execute(holding("doc.page.read"), { space: "guide", path: "admins" }),
    ).rejects.toThrow(NotFoundError);
  });

  it("leaves the hidden page out of the tree it returns", async () => {
    const reading = await useCase().execute(holding("doc.page.read"), {
      space: "guide",
      path: "start",
    });
    expect(reading.space.nav.map((entry) => entry.path)).toEqual(["start"]);
  });

  it("serves the page to a reader holding the permission", async () => {
    const reading = await useCase().execute(holding("doc.page.read", "rbac.role.manage"), {
      space: "guide",
      path: "admins",
    });
    expect(reading.page?.id).toBe(pageId(2));
  });
});
