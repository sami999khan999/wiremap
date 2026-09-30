import type { Clock } from "../import.js";
import type { CacheStore, UnitOfWork } from "../port/index.js";
import type { Authorizer, Principal } from "../primitive/index.js";
import { CountUnreadNotificationsUseCase } from "./count-unread-notifications.use-case.js";
import type { NotificationRepository } from "./notification.repository.js";

// Its own use-case rather than an optional id on the one above: "clear everything" is a
// different intent, and one entry point doing both makes an empty body do it by accident.
export class MarkAllNotificationsReadUseCase {
  public constructor(
    private readonly authorizer: Authorizer,
    private readonly notifications: NotificationRepository,
    private readonly cache: CacheStore,
    private readonly clock: Clock,
    private readonly unitOfWork: UnitOfWork,
  ) {}

  public async execute(actor: Principal): Promise<void> {
    this.authorizer.assert(actor, "notification.inbox.update");

    // In a unit of work for the move freeze, which is enforced there and nowhere else: a
    // routed write outside one landed on the source during a move and was lost (`CR.11`).
    await this.unitOfWork.run(() =>
      this.notifications.markAllRead(actor.organizationId, actor.userId, this.clock.now()),
    );
    await this.cache.delete(CountUnreadNotificationsUseCase.keyFor(actor));
  }
}
