import type { PermissionKey } from "../import.js";

export const activityProcedurePermissions = {
  "activity.list": "audit.log.read",
} as const satisfies Record<string, PermissionKey>;
