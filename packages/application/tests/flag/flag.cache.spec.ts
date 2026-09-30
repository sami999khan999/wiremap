import { Identifiers, type OrganizationId, type UserId } from "@loadbearing/contracts";
import { type AppError, NotFoundError } from "@loadbearing/errors";
import { CapabilitySet } from "@loadbearing/permissions";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FlagCache } from "../../src/flag/flag.cache.js";
import { type FlagRecord, FlagRepository } from "../../src/flag/flag.repository.js";
import type { CacheStore } from "../../src/port/index.js";
import { Principal } from "../../src/primitive/principal.js";
import { declareExampleFlag, EXAMPLE_FLAG } from "../support/example-flag.js";

const TARGETED = Identifiers.organizationId.parse("018f8c00-0000-7000-8000-000000000010");
const OTHER = Identifiers.organizationId.parse("018f8c00-0000-7000-8000-000000000020");
const USER = Identifiers.userId.parse("018f8c00-0000-7000-8000-000000000011");

class StubFlags extends FlagRepository {
  public reads = 0;

  public constructor(private readonly rows: readonly FlagRecord[]) {
    super();
  }

  public override findAll(): Promise<readonly FlagRecord[]> {
    this.reads += 1;
    return Promise.resolve(this.rows);
  }

  public override save(_key: string, _isEnabled: boolean, _actor: UserId): Promise<void> {
    return Promise.resolve();
  }

  public override saveTarget(_key: string, _org: OrganizationId, _actor: UserId): Promise<void> {
    return Promise.resolve();
  }

  public override deleteTarget(_key: string, _org: OrganizationId): Promise<void> {
    return Promise.resolve();
  }
}

// Round-trips through JSON, as Redis does, so a Date or a Set would fail here too.
class JsonCacheStore implements CacheStore {
  private readonly entries = new Map<string, string>();

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

const row = (overrides: Partial<FlagRecord>): FlagRecord => ({
  key: EXAMPLE_FLAG,
  isEnabled: false,
  targets: [],
  updatedAt: null,
  ...overrides,
});

const principal = (organizationId: OrganizationId) =>
  new Principal(organizationId, USER, CapabilitySet.empty());

beforeEach(declareExampleFlag);
afterEach(() => vi.restoreAllMocks());

describe("FlagCache", () => {
  it("is on for every org when the deployment switch is on", async () => {
    const cache = new FlagCache(new StubFlags([row({ isEnabled: true })]), new JsonCacheStore());

    expect(await cache.onFor(TARGETED)).toEqual([EXAMPLE_FLAG]);
    expect(await cache.isOn(OTHER, EXAMPLE_FLAG)).toBe(true);
  });

  it("is on only for a targeted org while the switch is off", async () => {
    const targets = [{ organizationId: TARGETED, slug: "targeted" }];
    const cache = new FlagCache(new StubFlags([row({ targets })]), new JsonCacheStore());

    expect(await cache.isOn(TARGETED, EXAMPLE_FLAG)).toBe(true);
    expect(await cache.isOn(OTHER, EXAMPLE_FLAG)).toBe(false);
  });

  it("is off when there is no row at all", async () => {
    const cache = new FlagCache(new StubFlags([]), new JsonCacheStore());

    expect(await cache.onFor(TARGETED)).toEqual([]);
  });

  // A retired flag's row stays until someone clears it. The code no longer reads it, and
  // the session must not start carrying a name nothing declares.
  it("ignores a row whose flag the code no longer declares", async () => {
    const cache = new FlagCache(
      new StubFlags([row({ key: "retired.flag", isEnabled: true })]),
      new JsonCacheStore(),
    );

    expect(await cache.onFor(TARGETED)).toEqual([]);
  });

  it("reads the repository once, then serves from the cache until invalidated", async () => {
    const flags = new StubFlags([row({ isEnabled: true })]);
    const cache = new FlagCache(flags, new JsonCacheStore());

    await cache.onFor(TARGETED);
    await cache.onFor(OTHER);
    expect(flags.reads).toBe(1);

    await cache.invalidate();
    await cache.onFor(TARGETED);
    expect(flags.reads).toBe(2);
  });

  // The load-bearing one. `ErrorInterceptor` sends `toJSON()` to the browser, and a
  // server-only flag's name must never reach it.
  it("throws NOT_FOUND for an off flag, and the error names no flag", async () => {
    const cache = new FlagCache(new StubFlags([]), new JsonCacheStore());

    const error = await cache.assertOn(principal(TARGETED), EXAMPLE_FLAG).catch((e) => e);

    expect(error).toBeInstanceOf(NotFoundError);
    expect((error as AppError).code).toBe("NOT_FOUND");
    expect(JSON.stringify((error as AppError).toJSON())).not.toContain(EXAMPLE_FLAG);
    expect(JSON.stringify((error as AppError).toJSON())).not.toContain("rollout");
  });

  it("passes an on flag without a throw", async () => {
    const cache = new FlagCache(new StubFlags([row({ isEnabled: true })]), new JsonCacheStore());

    await expect(cache.assertOn(principal(TARGETED), EXAMPLE_FLAG)).resolves.toBeUndefined();
  });
});
