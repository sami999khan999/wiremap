import { aiPermissions } from "./ai.permissions.js";
import { analyticsPermissions } from "./analytics.permissions.js";
import { apiKeyPermissions } from "./apikey.permissions.js";
import { corePermissions } from "./core.permissions.js";
import { docPermissions } from "./doc.permissions.js";
import { memberPermissions } from "./member.permissions.js";
import { messagingPermissions } from "./messaging.permissions.js";
import { notificationPermissions } from "./notification.permissions.js";
import { platformPermissions } from "./platform.permissions.js";
import { rbacPermissions } from "./rbac.permissions.js";
import { widgetPermissions } from "./widget.permissions.js";

// Merged from team-owned fragments. Add them here — `...taskPermissions`.
export const CATALOG = {
  ...corePermissions,
  ...rbacPermissions,
  ...memberPermissions,
  ...messagingPermissions,
  ...notificationPermissions,
  ...apiKeyPermissions,
  ...aiPermissions,
  ...analyticsPermissions,
  ...platformPermissions,
  ...widgetPermissions,
  ...docPermissions,
} as const;
