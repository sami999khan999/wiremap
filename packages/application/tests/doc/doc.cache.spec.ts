import { type DocNavNodeDto, type DocPageId, Identifiers } from "@loadbearing/contracts";
import { describe, expect, it } from "vitest";
import { DocCache } from "../../src/doc/doc.cache.js";
import type { DocPageRepository } from "../../src/doc/doc-page.repository.js";
import type { DocSpaceRecord, DocSpaceRepository } from "../../src/doc/doc-space.repository.js";
import type { CacheStore } from "../../src/port/index.js";

const ORG = Identifiers.organizationId.parse("018f8c00-0000-7000-8000-000000000010");
const PAGE = Identifiers.docPageId.parse("018f8c00-0000-7000-8000-000000000020") as DocPageId;

// A Map, round-tripped through JSON as Redis would: dates come back as strings.
class MemoryCache implements CacheStore {
  public readonly entries = new Map<string, string>();
  public get<T>(key: string): Promise<T | null> {
    const raw = this.entries.get(key);
    return Promise.resolve(raw === undefined ? null : (JSON.parse(raw) as T));
  }
  public set<T>(key: string, value: T): Promise<void> {
    this.entries.set(key, JSON.stringify(value));
    return Promise.resolve();
  }
  public setIfAbsent<T>(key: string, value: T): Promise<boolean> {
    if (this.entries.has(key)) return Promise.resolve(false);
    this.entries.set(key, JSON.stringify(value));
    return Promise.resolve(true);
  }
  public delete(key: string): Promise<void> {
    this.entries.delete(key);
    return Promise.resolve();
  }
  public deletePrefix(prefix: string): Promise<void> {
    for (const key of this.entries.keys()) if (key.startsWith(prefix)) this.entries.delete(key);
    return Promise.resolve();
  }
}

const nav: readonly DocNavNodeDto[] = [
  {
    id: PAGE,
    kind: "page",
    title: "Start",
    icon: null,
    path: "start",
    url: null,
    revisionNo: 1,
    children: [],
  },
];

const space = {
  id: Identifiers.docSpaceId.parse("018f8c00-0000-7000-8000-000000000030"),
  organizationId: ORG,
  slug: "guide",
  title: "Guide",
  audience: "public",
  updatedAt: new Date(0),
  nav,
  version: 1,
} as unknown as DocSpaceRecord;

const page = { id: PAGE, revisionNo: 1, publishedAt: new Date(0), html: "<p>x</p>" };

// Counts every repository call, which is what a warm read must make none of.
const counting = () => {
  const calls: string[] = [];
  const spaces = {
    list: () => {
      calls.push("spaces.list");
      return Promise.resolve([space]);
    },
    findBySlug: () => {
      calls.push("spaces.findBySlug");
      return Promise.resolve(space);
    },
  } as unknown as DocSpaceRepository;
  const pages = {
    findPublished: () => {
      calls.push("pages.findPublished");
      return Promise.resolve(page);
    },
  } as unknown as DocPageRepository;
  return { calls, cache: new DocCache(new MemoryCache(), spaces, pages) };
};

describe("DocCache", () => {
  it("answers a warm page read with no repository call", async () => {
    const { calls, cache } = counting();
    await cache.read(ORG, "guide", "start");
    expect(calls).toEqual(["spaces.findBySlug", "pages.findPublished"]);

    calls.length = 0;
    const warm = await cache.read(ORG, "guide", "start");
    expect(calls).toEqual([]);
    expect(warm.space.updatedAt).toBeInstanceOf(Date);
  });

  it("caches the space list, and forgets it with any space", async () => {
    const { calls, cache } = counting();
    await cache.list(ORG);
    await cache.list(ORG);
    expect(calls).toEqual(["spaces.list"]);

    await cache.forget(ORG, "guide");
    await cache.list(ORG);
    expect(calls).toEqual(["spaces.list", "spaces.list"]);
  });
});
