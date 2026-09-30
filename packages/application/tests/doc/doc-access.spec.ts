import {
  type DocSpaceId,
  Identifiers,
  type OrganizationId,
  type UserId,
} from "@loadbearing/contracts";
import { CapabilitySet, type PermissionKey } from "@loadbearing/permissions";
import { describe, expect, it } from "vitest";
import { DocAccess } from "../../src/doc/doc-access.js";
import { DocGrantRepository } from "../../src/doc/doc-grant.repository.js";
import type { DocSpaceSummary } from "../../src/doc/doc-space.repository.js";
import type { CacheStore } from "../../src/port/index.js";
import { Principal } from "../../src/primitive/principal.js";

const PLATFORM = Identifiers.organizationId.parse("018f8c00-0000-7000-8000-000000000001");
const TENANT = Identifiers.organizationId.parse("018f8c00-0000-7000-8000-000000000002");
const SPACE = Identifiers.docSpaceId.parse("018f8c00-0000-7000-8000-000000000010");
const USER = Identifiers.userId.parse("018f8c00-0000-7000-8000-000000000020");
// Not `USER`: an `owner` space's author, so every viewer built from `viewer()` is someone else.
const AUTHOR = Identifiers.userId.parse("018f8c00-0000-7000-8000-000000000030");

const space = (audience: DocSpaceSummary["audience"]): DocSpaceSummary => ({
  id: SPACE,
  organizationId: PLATFORM,
  slug: "s",
  title: "S",
  description: null,
  icon: null,
  audience,
  theme: null,
  createdBy: AUTHOR,
  position: 0,
  version: 1,
  updatedAt: new Date(0),
});

const viewer = (
  organizationId: OrganizationId,
  grants: readonly PermissionKey[] = [],
  platform: readonly PermissionKey[] = [],
) =>
  new Principal(
    organizationId,
    USER,
    CapabilitySet.from({
      wildcard: false,
      org: { grants: [...grants], denies: [] },
      goals: {},
      platform: { grants: [...platform], denies: [] },
    }),
  );

// Counts its reads, so the spec can see the cache doing its job.
class Grants extends DocGrantRepository {
  public reads = 0;
  public constructor(private readonly open: readonly DocSpaceId[]) {
    super();
  }
  public list = () => Promise.resolve([]);
  public findGrantee = () => Promise.resolve(null);
  public save = () => Promise.reject(new Error("unused"));
  public delete = () => Promise.resolve(null);
  public deleteBySpace = () => Promise.resolve();
  public readableSpaceIds = (_org: OrganizationId, _user: UserId) => {
    this.reads += 1;
    return Promise.resolve(this.open);
  };
}

class MemoryCache {
  public readonly store = new Map<string, unknown>();
  public get = (key: string) => Promise.resolve(this.store.get(key) ?? null);
  public set = (key: string, value: unknown) => {
    this.store.set(key, value);
    return Promise.resolve();
  };
  public setIfAbsent = () => Promise.resolve(true);
  public delete = () => Promise.resolve();
  public deletePrefix = (prefix: string) => {
    for (const key of [...this.store.keys()]) if (key.startsWith(prefix)) this.store.delete(key);
    return Promise.resolve();
  };
}

const access = (open: readonly DocSpaceId[] = []) => {
  const grants = new Grants(open);
  const cache = new MemoryCache();
  return { grants, cache, access: new DocAccess(grants, cache as unknown as CacheStore) };
};

describe("DocAccess", () => {
  it("opens a public space to anyone and nothing else to an anonymous reader", async () => {
    const { access: a } = access([SPACE]);
    expect(await a.canRead(null, space("public"), PLATFORM)).toBe(true);
    expect(await a.canRead(null, space("granted"), PLATFORM)).toBe(false);
    expect(await a.canRead(null, space("members"), PLATFORM)).toBe(false);
  });

  it("lets the platform's own staff read every audience through the ordinary key", async () => {
    const { access: a } = access();
    const staff = viewer(PLATFORM, ["doc.page.read"]);
    for (const audience of ["public", "granted", "members"] as const) {
      expect(await a.canRead(staff, space(audience), PLATFORM)).toBe(true);
    }
  });

  it("opens a granted space through a grant and never a members one", async () => {
    const { access: a } = access([SPACE]);
    const outsider = viewer(TENANT);
    expect(await a.canRead(outsider, space("granted"), PLATFORM)).toBe(true);
    expect(await a.canRead(outsider, space("members"), PLATFORM)).toBe(false);
  });

  it("refuses a granted space with no grant, unless the reader is a platform admin", async () => {
    const { access: a } = access([]);
    expect(await a.canRead(viewer(TENANT), space("granted"), PLATFORM)).toBe(false);
    expect(
      await a.canRead(viewer(TENANT, [], ["platform.doc.grant"]), space("granted"), PLATFORM),
    ).toBe(true);
  });

  // `LT3.5`: the author, and nobody else — not the platform's staff, not a platform admin,
  // not a grant, not a signed-out visitor. Each gets the same false a missing space does.
  it("lets only the author read an owner space", async () => {
    const { access: a } = access([SPACE]);
    const author = new Principal(PLATFORM, AUTHOR, CapabilitySet.empty());

    expect(await a.canRead(author, space("owner"), PLATFORM)).toBe(true);
    expect(await a.canRead(null, space("owner"), PLATFORM)).toBe(false);
    expect(await a.canRead(viewer(PLATFORM, ["doc.page.read"]), space("owner"), PLATFORM)).toBe(
      false,
    );
    expect(
      await a.canRead(viewer(TENANT, [], ["platform.doc.grant"]), space("owner"), PLATFORM),
    ).toBe(false);
    expect(await a.canRead(viewer(TENANT), space("owner"), PLATFORM)).toBe(false);
  });

  it("reads the grants once per viewer until they change, then again", async () => {
    const { access: a, grants } = access([SPACE]);
    const outsider = viewer(TENANT);
    await a.canRead(outsider, space("granted"), PLATFORM);
    await a.canRead(outsider, space("granted"), PLATFORM);
    expect(grants.reads).toBe(1);

    await a.forget();
    await a.canRead(outsider, space("granted"), PLATFORM);
    expect(grants.reads).toBe(2);
  });
});
