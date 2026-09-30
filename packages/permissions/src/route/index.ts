import { accountRoutes } from "./account.routes.js";
import { analyticsRoutes } from "./analytics.routes.js";
import { docRoutes } from "./doc.routes.js";
import { documentRoutes } from "./document.routes.js";
import { messagingRoutes } from "./messaging.routes.js";
import { notificationRoutes } from "./notification.routes.js";
import { organizationRoutes } from "./organization.routes.js";
import { platformRoutes } from "./platform.routes.js";
import { rbacRoutes } from "./rbac.routes.js";
import { shellRoutes } from "./shell.routes.js";
import { widgetRoutes } from "./widget.routes.js";

// Every declared path is rooted — a missing leading slash fails to compile.
export type RoutePath = `/${string}`;

// The one table of destinations, read by every shell. Grouped by slice so a team owns
// one fragment. Add them here — `task: taskRoutes`.
export const ROUTES = {
  shell: shellRoutes,
  account: accountRoutes,
  rbac: rbacRoutes,
  organization: organizationRoutes,
  document: documentRoutes,
  notification: notificationRoutes,
  messaging: messagingRoutes,
  analytics: analyticsRoutes,
  platform: platformRoutes,
  widget: widgetRoutes,
  doc: docRoutes,
} as const;

// Union of every path the table declares. `Extract<…, string>` so a group may later hold
// a builder for a parameterised route without widening this union to the function type.
export type AppRoute = {
  [G in keyof typeof ROUTES]: Extract<(typeof ROUTES)[G][keyof (typeof ROUTES)[G]], string>;
}[keyof typeof ROUTES];
