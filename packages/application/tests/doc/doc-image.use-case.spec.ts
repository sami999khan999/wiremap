import { type DocSpaceId, Identifiers, type OrganizationId } from "@loadbearing/contracts";
import { CapabilitySet, type PermissionKey } from "@loadbearing/permissions";
import { describe, expect, it } from "vitest";
import { DocAccess } from "../../src/doc/doc-access.js";
import { DocGrantRepository } from "../../src/doc/doc-grant.repository.js";
import { DocImageKey } from "../../src/doc/doc-image-key.js";
import { DocSpaceRepository, type DocSpaceSummary } from "../../src/doc/doc-space.repository.js";
import { OpenDocImageUseCase } from "../../src/doc/open-doc-image.use-case.js";
import type { PlatformReader } from "../../src/platform/platform.reader.js";
import type { CacheStore, StorageGateway } from "../../src/port/index.js";
import { Principal } from "../../src/primitive/principal.js";

const PLATFORM = Identifiers.organizationId.parse("018f8c00-0000-7000-8000-000000000001");
const TENANT = Identifiers.organizationId.parse("018f8c00-0000-7000-8000-000000000002");
const OTHER = Identifiers.organizationId.parse("018f8c00-0000-7000-8000-000000000003");
const SPACE = Identifiers.docSpaceId.parse("018f8c00-0000-7000-8000-000000000010");
const USER = Identifiers.userId.parse("018f8c00-0000-7000-8000-000000000020");
const ID = "018f8c00-0000-7000-8000-000000000030";

const viewer = (organizationId: OrganizationId, grants: readonly PermissionKey[]) =>
  new Principal(
    organizationId,
    USER,
    CapabilitySet.from({ wildcard: false, org: { grants: [...grants], denies: [] }, goals: {} }),
  );

const summary = (organizationId: OrganizationId, audience: DocSpaceSummary["audience"]) => ({
  id: SPACE,
  organizationId,
  slug: "s",
  title: "S",
  description: null,
  icon: null,
  audience,
  theme: null,
  createdBy: USER,
  position: 0,
  version: 1,
  updatedAt: new Date(0),
  nav: [],
});

// Only `findById` is reached; the rest would be a bug in the use-case.
class OneSpace extends DocSpaceRepository {
  public constructor(private readonly space: ReturnType<typeof summary> | null) {
    super();
  }
  public list = () => Promise.reject(new Error("unused"));
  public findById = (_org: OrganizationId, id: DocSpaceId) =>
    Promise.resolve(this.space && id === this.space.id ? this.space : null);
  public findBySlug = () => Promise.reject(new Error("unused"));
  public create = () => Promise.reject(new Error("unused"));
  public save = () => Promise.reject(new Error("unused"));
  public saveNav = () => Promise.reject(new Error("unused"));
  public delete = () => Promise.reject(new Error("unused"));
}

class NoGrants extends DocGrantRepository {
  public list = () => Promise.resolve([]);
  public findGrantee = () => Promise.resolve(null);
  public save = () => Promise.reject(new Error("unused"));
  public delete = () => Promise.resolve(null);
  public deleteBySpace = () => Promise.resolve();
  public readableSpaceIds = () => Promise.resolve([]);
}

const cache = {
  get: () => Promise.resolve(null),
  set: () => Promise.resolve(),
  setIfAbsent: () => Promise.resolve(true),
  delete: () => Promise.resolve(),
  deletePrefix: () => Promise.resolve(),
} as unknown as CacheStore;

const storage = {
  presignDownload: (key: string) => Promise.resolve(`signed:${key}`),
} as unknown as StorageGateway;

const platform = {
  organizationId: () => Promise.resolve(PLATFORM),
} as unknown as PlatformReader;

const build = (space: ReturnType<typeof summary> | null) =>
  new OpenDocImageUseCase(
    platform,
    new OneSpace(space),
    new DocAccess(new NoGrants(), cache),
    storage,
  );

describe("DocImageKey", () => {
  it("puts every image under its tenant and its space, so either is one prefix to delete", () => {
    const file = DocImageKey.file(ID, "image/png");
    expect(DocImageKey.key(TENANT, SPACE, file)).toBe(`doc/${TENANT}/${SPACE}/${ID}.png`);
    expect(
      DocImageKey.key(TENANT, SPACE, file).startsWith(DocImageKey.spacePrefix(TENANT, SPACE)),
    ).toBe(true);
  });

  it("round-trips through the URL and refuses what it would never have written", () => {
    const file = DocImageKey.file(ID, "image/webp");
    const [, , , , , extension, id] = DocImageKey.url(TENANT, SPACE, file).split("/");
    expect(DocImageKey.fileOf(extension ?? "", id ?? "")).toBe(file);
    expect(DocImageKey.fileOf("svg", ID)).toBeNull();
    expect(DocImageKey.fileOf("png", "../../secret")).toBeNull();
  });
});

describe("OpenDocImageUseCase", () => {
  const open = { organizationId: TENANT, spaceId: SPACE, extension: "png", id: ID };

  it("signs a member's own organization's image, whatever the space's audience", async () => {
    const image = await build(summary(TENANT, "members")).execute(
      viewer(TENANT, ["doc.page.read"]),
      open,
    );
    expect(image.url).toBe(`signed:doc/${TENANT}/${SPACE}/${ID}.png`);
    expect(image.public).toBe(false);
  });

  it("refuses a member of another organization, and one without the read key", async () => {
    await expect(
      build(summary(TENANT, "members")).execute(viewer(OTHER, ["doc.page.read"]), open),
    ).rejects.toThrow("NOT_FOUND");
    await expect(
      build(summary(TENANT, "members")).execute(viewer(TENANT, []), open),
    ).rejects.toThrow("NOT_FOUND");
  });

  it("serves the platform's public images to anyone and marks them shareable", async () => {
    const image = await build(summary(PLATFORM, "public")).execute(null, {
      ...open,
      organizationId: PLATFORM,
    });
    expect(image.public).toBe(true);
  });

  it("keeps a granted platform image from an anonymous reader and a tenant's from the world", async () => {
    await expect(
      build(summary(PLATFORM, "granted")).execute(null, { ...open, organizationId: PLATFORM }),
    ).rejects.toThrow("NOT_FOUND");
    await expect(build(summary(TENANT, "members")).execute(null, open)).rejects.toThrow(
      "NOT_FOUND",
    );
  });

  it("refuses a file name that is not one it would have written", async () => {
    await expect(
      build(summary(TENANT, "members")).execute(viewer(TENANT, ["doc.page.read"]), {
        ...open,
        extension: "svg",
      }),
    ).rejects.toThrow("NOT_FOUND");
  });
});
