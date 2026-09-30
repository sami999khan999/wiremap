import type { ModuleGate } from "../registry/index.js";
import { ROUTES } from "../route/index.js";

// One entry, on the read permission: the preferences page is reached from the inbox
// rather than from the nav, so it needs no gate of its own.
export const notificationGates = {
  notification: {
    permission: "notification.inbox.read",
    route: ROUTES.notification.inbox,
  },
} as const satisfies Record<string, ModuleGate>;
