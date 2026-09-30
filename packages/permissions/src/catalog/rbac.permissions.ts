import type { PermissionMeta } from "../registry/index.js";

export const rbacPermissions = {
  "rbac.role.read": { scope: "org", module: "rbac", label: "View roles" },
  "rbac.role.manage": {
    scope: "org",
    module: "rbac",
    label: "Create and edit roles",
    requires: ["rbac.role.read"],
  },
  "rbac.permission.grant": {
    scope: "org",
    module: "rbac",
    label: "Grant permissions",
    requires: ["rbac.role.read"],
  },
  "rbac.permission.revoke": {
    scope: "org",
    module: "rbac",
    label: "Revoke permissions",
    requires: ["rbac.role.read"],
  },
  // One person's exceptions to their role. Read is a reviewer's view of the drift;
  // manage writes it, and a grant always lapses.
  "rbac.override.read": {
    scope: "org",
    module: "rbac",
    label: "View per-person exceptions",
    requires: ["member.read"],
  },
  "rbac.override.manage": {
    scope: "org",
    module: "rbac",
    label: "Grant and deny permissions to one person",
    requires: ["rbac.override.read"],
  },
  "rbac.effective.inspect": {
    scope: "org",
    module: "rbac",
    label: "Inspect effective permissions",
  },
} as const satisfies Record<string, PermissionMeta>;
