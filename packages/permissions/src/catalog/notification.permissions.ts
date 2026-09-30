import type { PermissionMeta } from "../registry/index.js";

// Its own module, because the key grammar says so: these open `notification.` rather than
// extending an existing module's subject.
export const notificationPermissions = {
  "notification.inbox.read": {
    scope: "org",
    module: "notification",
    label: "View your notifications",
  },
  // Marking read is a write, and it is separate from reading: a role that may see the
  // inbox but not clear it is a coherent thing to want.
  "notification.inbox.update": {
    scope: "org",
    module: "notification",
    label: "Mark notifications read",
    requires: ["notification.inbox.read"],
  },
  // Separate again. Choosing how you are contacted is not the same power as reading what
  // you were sent, and an organization may want to fix the second while allowing the first.
  "notification.preference.update": {
    scope: "org",
    module: "notification",
    label: "Change your notification preferences",
  },
} as const satisfies Record<string, PermissionMeta>;
