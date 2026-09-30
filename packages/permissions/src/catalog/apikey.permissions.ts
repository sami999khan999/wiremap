import type { PermissionMeta } from "../registry/index.js";

// A module with no gate, like `account` has routes with none: nothing navigates to API
// keys yet. `ModuleKey` is the gated set, and this is the grouping one.
export const apiKeyPermissions = {
  "apikey.read": { scope: "org", module: "apikey", label: "View API keys" },
  "apikey.manage": {
    scope: "org",
    module: "apikey",
    label: "Create and revoke API keys",
    requires: ["apikey.read"],
  },
} as const satisfies Record<string, PermissionMeta>;
