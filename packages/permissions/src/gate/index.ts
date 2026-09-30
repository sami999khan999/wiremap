import { analyticsGates } from "./analytics.gate.js";
import { docGates } from "./doc.gate.js";
import { documentGates } from "./document.gate.js";
import { notificationGates } from "./notification.gate.js";
import { platformGates } from "./platform.gate.js";
import { rbacGates } from "./rbac.gate.js";
import { widgetGates } from "./widget.gate.js";

// Merged from team-owned fragments. Add them here — `...taskGates`.
export const GATES = {
  ...rbacGates,
  ...documentGates,
  ...notificationGates,
  ...analyticsGates,
  ...widgetGates,
  ...docGates,
  ...platformGates,
} as const;
