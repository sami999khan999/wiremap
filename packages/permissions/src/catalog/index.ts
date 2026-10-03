import { aiPermissions } from "./ai.permissions.js";
import { apiKeyPermissions } from "./apikey.permissions.js";
import { auditPermissions } from "./audit.permissions.js";
import { corePermissions } from "./core.permissions.js";
import { docPermissions } from "./doc.permissions.js";
import { memberPermissions } from "./member.permissions.js";
import { notificationPermissions } from "./notification.permissions.js";
import { organizationPermissions } from "./organization.permissions.js";
import { platformPermissions } from "./platform.permissions.js";
import { projectPermissions } from "./project.permissions.js";
import { rbacPermissions } from "./rbac.permissions.js";

// Merged from team-owned fragments. Add them here — `...taskPermissions`.
export const CATALOG = {
  ...corePermissions,
  ...rbacPermissions,
  ...memberPermissions,
  ...notificationPermissions,
  ...apiKeyPermissions,
  ...aiPermissions,
  ...platformPermissions,
  ...docPermissions,
  ...organizationPermissions,
  ...auditPermissions,
  ...projectPermissions,
} as const;
