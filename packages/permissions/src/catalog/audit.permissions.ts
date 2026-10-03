import type { PermissionMeta } from "../registry/index.js";

// Reading the audit trail. Writing it is `core.activity.write`, which every principal holds;
// reading it is not, because it names who did what to whom across the whole tenant.
export const auditPermissions = {
  "audit.log.read": {
    scope: "org",
    module: "audit",
    label: "View the audit log",
    requires: ["member.read"],
  },
} as const satisfies Record<string, PermissionMeta>;
