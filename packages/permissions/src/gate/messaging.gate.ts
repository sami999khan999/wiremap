import type { ModuleGate } from "../registry/index.js";
import { ROUTES } from "../route/index.js";

// On `read` rather than `create`: someone who can be added to a channel but may not open
// one still needs the nav entry that gets them to it.
export const messagingGates = {
  messaging: {
    permission: "messaging.conversation.read",
    route: ROUTES.messaging.inbox,
  },
} as const satisfies Record<string, ModuleGate>;
