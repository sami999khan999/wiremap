import type { PermissionKey } from "../import.js";

// One entry per path in `NotificationProcedures`. Reading the inbox and reading your own
// preferences are the same power: both are "what has this system got for me".
export const notificationProcedurePermissions = {
  "notification.list": "notification.inbox.read",
  "notification.unreadCount": "notification.inbox.read",
  "notification.markRead": "notification.inbox.update",
  "notification.markAllRead": "notification.inbox.update",
  "notification.preferences": "notification.inbox.read",
  "notification.updatePreference": "notification.preference.update",
} as const satisfies Record<string, PermissionKey>;
