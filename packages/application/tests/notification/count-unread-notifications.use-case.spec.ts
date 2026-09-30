import { Identifiers } from "@loadbearing/contracts";
import { CapabilitySet, type PermissionKey } from "@loadbearing/permissions";
import { describe, expect, it } from "vitest";
import { CountUnreadNotificationsUseCase } from "../../src/notification/count-unread-notifications.use-case.js";
import { MarkAllNotificationsReadUseCase } from "../../src/notification/mark-all-notifications-read.use-case.js";
import type {
  NotificationPage,
  NotificationRecord,
  NotificationRepository,
} from "../../src/notification/notification.repository.js";
import type { CacheStore } from "../../src/port/index.js";
import { Authorizer, Principal } from "../../src/primitive/index.js";

const ORG = Identifiers.organizationId.parse("018f8c00-0000-7000-8000-000000000010");
const USER = Identifiers.userId.parse("018f8c00-0000-7000-8000-000000000011");
const KEY = `notification:unread:${ORG}:${USER}`;

const actorHolding = (...grants: readonly PermissionKey[]) =>
  new Principal(
    ORG,
    USER,
    CapabilitySet.from({ wildcard: false, org: { grants, denies: [] }, goals: {} }),
  );

class Counting implements NotificationRepository {
  public calls = 0;

  public constructor(private readonly value = 7) {}

  public list(): Promise<NotificationPage> {
    return Promise.resolve({ items: [], nextCursor: null });
  }

  public countUnread(): Promise<number> {
    this.calls += 1;
    return Promise.resolve(this.value);
  }

  public saveMany(): Promise<readonly (typeof USER)[]> {
    return Promise.resolve([]);
  }

  public unreadSubjectHolders(): Promise<ReadonlySet<never>> {
    return Promise.resolve(new Set());
  }

  public markRead(): Promise<void> {
    return Promise.resolve();
  }

  public markAllRead(): Promise<void> {
    return Promise.resolve();
  }

  public listUnreadBetween(): Promise<ReadonlyMap<typeof USER, readonly NotificationRecord[]>> {
    return Promise.resolve(new Map());
  }

  public recipientsWithUnreadBetween(): Promise<readonly never[]> {
    return Promise.resolve([]);
  }
}

class Memory implements CacheStore {
  private readonly store = new Map<string, unknown>();

  public get<T>(key: string): Promise<T | null> {
    return Promise.resolve((this.store.get(key) as T | undefined) ?? null);
  }

  public set<T>(key: string, value: T): Promise<void> {
    this.store.set(key, value);
    return Promise.resolve();
  }

  public setIfAbsent<T>(key: string, value: T): Promise<boolean> {
    if (this.store.has(key)) return Promise.resolve(false);
    this.store.set(key, value);
    return Promise.resolve(true);
  }

  public delete(key: string): Promise<void> {
    this.store.delete(key);
    return Promise.resolve();
  }

  public deletePrefix(): Promise<void> {
    return Promise.resolve();
  }
}

describe("CountUnreadNotificationsUseCase", () => {
  // The bell is on every page, so an uncached count is one query per navigation per
  // user. Postgres stays the truth; this is the 100k answer.
  it("reads through the cache once and serves the second call from it", async () => {
    const repository = new Counting();
    const useCase = new CountUnreadNotificationsUseCase(new Authorizer(), repository, new Memory());
    const actor = actorHolding("notification.inbox.read");

    expect(await useCase.execute(actor)).toEqual({ count: 7 });
    expect(await useCase.execute(actor)).toEqual({ count: 7 });
    expect(repository.calls).toBe(1);
  });

  // Otherwise the badge stays a minute behind a row the reader has already cleared,
  // which reads as the feature being broken rather than as a cache.
  it("recounts after a write invalidates the key", async () => {
    const repository = new Counting();
    const cache = new Memory();
    const count = new CountUnreadNotificationsUseCase(new Authorizer(), repository, cache);
    const markAll = new MarkAllNotificationsReadUseCase(
      new Authorizer(),
      repository,
      cache,
      { now: () => new Date("2026-08-15T00:00:00Z") },
      { run: (work: () => Promise<unknown>) => work() } as never,
    );
    const actor = actorHolding("notification.inbox.read", "notification.inbox.update");

    await count.execute(actor);
    await markAll.execute(actor);
    await count.execute(actor);

    expect(repository.calls).toBe(2);
  });

  it("keys the cache per tenant and per user", () => {
    expect(CountUnreadNotificationsUseCase.keyFor(actorHolding())).toBe(KEY);
  });
});
