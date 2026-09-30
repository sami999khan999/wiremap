import type { ModuleGate } from "../registry/index.js";
import { ROUTES } from "../route/index.js";

export const analyticsGates = {
  analytics: {
    permission: "analytics.activity.read",
    route: ROUTES.analytics.activity,
  },
} as const satisfies Record<string, ModuleGate>;
