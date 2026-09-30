import type { CacheStore } from "../port/index.js";
import type { Authorizer, Principal } from "../primitive/index.js";
import type { NotificationRepository } from "./notification.repository.js";

// Past this the badge reads "99+", so counting further is work nobody reads over a
// table that grows forever.
const CAP = 100;

// Sixty seconds. Postgres is the truth and this is the 100k answer: the bell is on every
// page, so an uncached count is one query per navigation per user.
const TTL_SECONDS = 60;

export class CountUnreadNotificationsUseCase {
  public constructor(
    private readonly authorizer: Authorizer,
    private readonly notifications: NotificationRepository,
    private readonly cache: CacheStore,
  ) {}

  public async execute(actor: Principal): Promise<{ readonly count: number }> {
    this.authorizer.assert(actor, "notification.inbox.read");

    const key = CountUnreadNotificationsUseCase.keyFor(actor);
    const cached = await this.cache.get<number>(key);
    if (typeof cached === "number") return { count: cached };

    const count = await this.notifications.countUnread(actor.organizationId, actor.userId, CAP);
    await this.cache.set(key, count, TTL_SECONDS);

    return { count };
  }

  // Deleted by every write for that user, so a read-through cannot serve a count the
  // reader has already invalidated by clicking.
  public static keyFor(actor: Principal): string {
    return `notification:unread:${actor.organizationId}:${actor.userId}`;
  }

  public static key(organizationId: string, userId: string): string {
    return `notification:unread:${organizationId}:${userId}`;
  }
}
