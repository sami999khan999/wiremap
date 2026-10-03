import type { PermissionKey } from "../import.js";

export const activityProcedurePermissions = {
  "activity.list": "audit.log.read",
  "activity.project": "project.graph.read",
} as const satisfies Record<string, PermissionKey>;
