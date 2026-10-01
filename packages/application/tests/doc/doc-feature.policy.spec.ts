import { type DocAccessRuleDto, type DocNavNodeDto, Identifiers } from "@loadbearing/contracts";
import { ValidationError } from "@loadbearing/errors";
import { CapabilitySet, type PermissionKey } from "@loadbearing/permissions";
import { describe, expect, it } from "vitest";
import { DocFeaturePolicy } from "../../src/doc/doc-feature.policy.js";
import type { FlagCache } from "../../src/flag/index.js";
import type { EntitlementRepository } from "../../src/platform/index.js";
import type { CacheStore } from "../../src/port/index.js";
import { Principal } from "../../src/primitive/principal.js";

const ORG = Identifiers.organizationId.parse("018f8c00-0000-7000-8000-000000000010");
const USER = Identifiers.userId.parse("018f8c00-0000-7000-8000-000000000011");

const holding = (...grants: readonly PermissionKey[]) =>
  new Principal(
    ORG,
    USER,
    CapabilitySet.from({ wildcard: false, org: { grants: [...grants], denies: [] }, goals: {} }),
  );

const rule = (links: Partial<DocAccessRuleDto>): DocAccessRuleDto => ({
  module: null,
  permission: null,
  flag: null,
  plan: null,
  ...links,
});

class MemoryCache implements CacheStore {
  private readonly entries = new Map<string, string>();
  public get<T>(key: string): Promise<T | null> {
    const raw = this.entries.get(key);
    return Promise.resolve(raw === undefined ? null : (JSON.parse(raw) as T));
  }
  public set<T>(key: string, value: T): Promise<void> {
    this.entries.set(key, JSON.stringify(value));
    return Promise.resolve();
  }
  public setIfAbsent(): Promise<boolean> {
    return Promise.resolve(true);
  }
  public delete(): Promise<void> {
    return Promise.resolve();
  }
  public deletePrefix(): Promise<void> {
    return Promise.resolve();
  }
}

// Counts the two lookups a link may need, which is what "costs nothing unlinked" means.
const policy = (options: { flags?: readonly string[]; plan?: string | null } = {}) => {
  const reads = { flags: 0, plan: 0 };
  const flags = {
    onFor: () => {
      reads.flags += 1;
      return Promise.resolve(options.flags ?? []);
    },
  } as unknown as FlagCache;
  const entitlements = {
    findPlanOf: () => {
      reads.plan += 1;
      return Promise.resolve(options.plan ?? null);
    },
    findPlan: (key: string) => Promise.resolve(key === "team" ? { key } : null),
    findPlans: () => Promise.resolve([{ key: "team", name: "Team" }]),
  } as unknown as EntitlementRepository;
  return { reads, policy: new DocFeaturePolicy(flags, entitlements, new MemoryCache()) };
};

describe("DocFeaturePolicy.allows", () => {
  it("lets anyone through a doc with no link, signed out included, and reads nothing", async () => {
    const { reads, policy: features } = policy();
    expect(await features.allows(features.scope(null), null)).toBe(true);
    expect(await features.allows(features.scope(null), rule({}))).toBe(true);
    expect(reads).toEqual({ flags: 0, plan: 0 });
  });

  it("follows a module through its gate's permission", async () => {
    const { policy: features } = policy();
    const linked = rule({ module: "apikey" });
    expect(await features.allows(features.scope(holding("apikey.read")), linked)).toBe(true);
    expect(await features.allows(features.scope(holding("member.read")), linked)).toBe(false);
  });

  it("follows a permission", async () => {
    const { policy: features } = policy();
    const linked = rule({ permission: "rbac.role.manage" });
    expect(await features.allows(features.scope(holding("rbac.role.manage")), linked)).toBe(true);
    expect(await features.allows(features.scope(holding("rbac.role.read")), linked)).toBe(false);
  });

  it("follows a flag on for the reader's organization", async () => {
    const on = policy({ flags: ["task.bulk-edit"] });
    const off = policy({ flags: [] });
    const linked = rule({ flag: "task.bulk-edit" });
    expect(await on.policy.allows(on.policy.scope(holding()), linked)).toBe(true);
    expect(await off.policy.allows(off.policy.scope(holding()), linked)).toBe(false);
  });

  it("follows a plan, read once and cached", async () => {
    const { reads, policy: features } = policy({ plan: "team" });
    expect(await features.allows(features.scope(holding()), rule({ plan: "team" }))).toBe(true);
    expect(await features.allows(features.scope(holding()), rule({ plan: "pro" }))).toBe(false);
    expect(reads.plan).toBe(1);
  });

  // An AND: each link narrows, so a reader holding the module but not the plan is out.
  it("needs every link to pass", async () => {
    const { policy: features } = policy({ plan: "free" });
    const both = rule({ module: "apikey", plan: "team" });
    expect(await features.allows(features.scope(holding("apikey.read")), both)).toBe(false);
  });

  it("shuts out a signed-out reader on any link", async () => {
    const { policy: features } = policy();
    expect(await features.allows(features.scope(null), rule({ permission: "member.read" }))).toBe(
      false,
    );
  });

  // A link to a feature that has gone hides the doc; it must never open it.
  it("fails closed on a key no registry knows", async () => {
    const { policy: features } = policy();
    const scope = features.scope(holding("apikey.read"));
    expect(await features.allows(scope, rule({ module: "gone" }))).toBe(false);
    expect(await features.allows(scope, rule({ permission: "gone.thing.read" }))).toBe(false);
  });
});

describe("DocFeaturePolicy.filterNav", () => {
  const page = (id: string, path: string, access?: DocAccessRuleDto): DocNavNodeDto => ({
    id: Identifiers.docPageId.parse(`018f8c00-0000-7000-8000-${id.padStart(12, "0")}`),
    kind: "page",
    title: path,
    icon: null,
    path,
    url: null,
    revisionNo: 1,
    children: [],
    ...(access ? { access } : {}),
  });
  const linked = rule({ permission: "rbac.role.manage" });
  const nav: readonly DocNavNodeDto[] = [
    { ...page("1", "open"), children: [page("2", "open/child")] },
    { ...page("3", "closed", linked), children: [page("4", "closed/child")] },
    {
      ...page("5", "section"),
      kind: "section",
      path: null,
      revisionNo: null,
      children: [page("6", "only", linked)],
    },
  ];

  it("takes a hidden page's children with it, and drops a section left empty", async () => {
    const { policy: features } = policy();
    const kept = await features.filterNav(features.scope(holding()), nav);
    expect(kept.map((node) => node.path)).toEqual(["open"]);
    expect(kept[0]?.children.map((node) => node.path)).toEqual(["open/child"]);
  });

  it("returns a tree with no link as it was, without copying it", async () => {
    const { policy: features } = policy();
    const plain = [page("1", "a"), page("2", "b")];
    expect(await features.filterNav(features.scope(null), plain)).toBe(plain);
  });
});

describe("DocFeaturePolicy.assertKnown", () => {
  it("refuses a key that does not exist, naming the field", async () => {
    const { policy: features } = policy();
    await expect(features.assertKnown(rule({ module: "gone", plan: "nope" }))).rejects.toThrow(
      ValidationError,
    );
    await expect(features.assertKnown(rule({ module: "apikey", plan: "team" }))).resolves.toBe(
      undefined,
    );
  });

  // A platform key is never held inside an organization, so a doc linked to it is unreadable.
  it("refuses a platform-scope permission", async () => {
    const { policy: features } = policy();
    await expect(
      features.assertKnown(rule({ permission: "platform.status.read" })),
    ).rejects.toThrow(ValidationError);
  });
});
