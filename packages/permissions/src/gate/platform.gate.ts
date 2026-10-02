import type { ModuleGate } from "../registry/index.js";
import { PLATFORM_ROUTE_PERMISSION, ROUTES } from "../route/index.js";

// One module for the whole tier, shown to anyone holding any platform page's key. `/platform`
// forwards to the first of those pages the reader may open.
export const platformGates = {
  platform: {
    permission: "platform.status.read",
    anyOf: Object.values(PLATFORM_ROUTE_PERMISSION),
    route: ROUTES.platform.home,
  },
} as const satisfies Record<string, ModuleGate>;
