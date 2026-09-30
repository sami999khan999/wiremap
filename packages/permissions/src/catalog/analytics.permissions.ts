import type { PermissionMeta } from "../registry/index.js";

// Reading the tenant's own activity out of the analytics store — `23.14`. Org-scoped: a
// tenant sees its own rows, and the reader is handed the tenant rather than asking.
export const analyticsPermissions = {
  "analytics.activity.read": {
    scope: "org",
    module: "analytics",
    label: "View activity analytics",
  },
} as const satisfies Record<string, PermissionMeta>;
