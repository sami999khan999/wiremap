import { authed } from "../import.js";

// Three lines per procedure, as `MemberRouter`. Nothing here names a user: every one of
// these acts on the principal's own inbox, and an input carrying a userId would be a hole.
export class NotificationRouter {
  private constructor() {}

  public static readonly list = authed.notification.list.handler(({ input, context }) =>
    context.container.notification.list.execute(context.principal, input),
  );

  public static readonly unreadCount = authed.notification.unreadCount.handler(({ context }) =>
    context.container.notification.countUnread.execute(context.principal),
  );

  public static readonly markRead = authed.notification.markRead.handler(
    async ({ input, context }) => {
      await context.container.notification.markRead.execute(context.principal, input);
      return { ok: true as const };
    },
  );

  public static readonly markAllRead = authed.notification.markAllRead.handler(
    async ({ context }) => {
      await context.container.notification.markAllRead.execute(context.principal);
      return { ok: true as const };
    },
  );

  // Paginated for shape rather than for size: the grid is categories × channels, and the
  // envelope is what every list procedure here returns.
  public static readonly preferences = authed.notification.preferences.handler(
    async ({ context }) => {
      const items = await context.container.notification.preferences.execute(context.principal);
      return { items, total: items.length, limit: items.length || 1, offset: 0 };
    },
  );

  public static readonly updatePreference = authed.notification.updatePreference.handler(
    async ({ input, context }) => {
      await context.container.notification.updatePreference.execute(context.principal, input);
      return { ok: true as const };
    },
  );

  // The object the merge point in `app.router.ts` mounts, mirroring
  // `NotificationProcedures.all`.
  public static readonly all = {
    list: NotificationRouter.list,
    unreadCount: NotificationRouter.unreadCount,
    markRead: NotificationRouter.markRead,
    markAllRead: NotificationRouter.markAllRead,
    preferences: NotificationRouter.preferences,
    updatePreference: NotificationRouter.updatePreference,
  } as const;
}
