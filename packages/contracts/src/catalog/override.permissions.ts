import type { PermissionKey } from "../import.js";

// Read to review the drift, manage to write it. Every write passes the same no-escalation
// and no-outranking checks inside the use-case; this map is the transport's first gate.
export const overrideProcedurePermissions = {
  "override.list": "rbac.override.read",
  "override.grant": "rbac.override.manage",
  "override.deny": "rbac.override.manage",
  "override.clear": "rbac.override.manage",
} as const satisfies Record<string, PermissionKey>;
