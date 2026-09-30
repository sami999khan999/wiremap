import type { PermissionKey } from "../import.js";

// One entry per path in `AnalyticsProcedures`.
export const analyticsProcedurePermissions = {
  "analytics.activity": "analytics.activity.read",
} as const satisfies Record<string, PermissionKey>;
