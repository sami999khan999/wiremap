import type { PermissionKey } from "../import.js";
import { analyticsProcedurePermissions } from "./analytics.permissions.js";
import { apiKeyProcedurePermissions } from "./apikey.permissions.js";
import { docProcedurePermissions } from "./doc.permissions.js";
import { documentProcedurePermissions } from "./document.permissions.js";
import { memberProcedurePermissions } from "./member.permissions.js";
import { notificationProcedurePermissions } from "./notification.permissions.js";
import { overrideProcedurePermissions } from "./override.permissions.js";
import { platformProcedurePermissions } from "./platform.permissions.js";
import { realtimeProcedurePermissions } from "./realtime.permissions.js";
import { roleProcedurePermissions } from "./role.permissions.js";

// Merged from team-owned fragments, one per slice — add them here. Not re-exported:
// nothing outside this package may read it.
export const PROCEDURE_PERMISSIONS: Readonly<Record<string, PermissionKey>> = {
  ...roleProcedurePermissions,
  ...memberProcedurePermissions,
  ...notificationProcedurePermissions,
  ...realtimeProcedurePermissions,
  ...apiKeyProcedurePermissions,
  ...documentProcedurePermissions,
  ...platformProcedurePermissions,
  ...analyticsProcedurePermissions,
  ...overrideProcedurePermissions,
  ...docProcedurePermissions,
};

export { ACTIVITY_ACTIONS } from "./activity-actions.js";
export { DOMAIN_EVENTS } from "./domain-events.js";
