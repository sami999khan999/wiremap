import type { ListNotificationsInput } from "../import.js";
import type { Authorizer, Principal } from "../primitive/index.js";
import type { NotificationPage, NotificationRepository } from "./notification.repository.js";

export class ListNotificationsUseCase {
  public constructor(
    private readonly authorizer: Authorizer,
    private readonly notifications: NotificationRepository,
  ) {}

  // Always the actor's own inbox. There is no "list someone else's": the permission
  // grants you *your* notifications, and a userId input would be the hole.
  public async execute(actor: Principal, input: ListNotificationsInput): Promise<NotificationPage> {
    this.authorizer.assert(actor, "notification.inbox.read");

    return this.notifications.list(actor.organizationId, actor.userId, input);
  }
}
