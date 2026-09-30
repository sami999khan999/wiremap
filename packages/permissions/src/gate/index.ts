import { docGates } from "./doc.gate.js";
import { documentGates } from "./document.gate.js";
import { notificationGates } from "./notification.gate.js";
import { platformGates } from "./platform.gate.js";
import { rbacGates } from "./rbac.gate.js";

// Merged from team-owned fragments. Add them here — `...taskGates`.
export const GATES = {
  ...rbacGates,
  ...documentGates,
  ...notificationGates,
  ...docGates,
  ...platformGates,
} as const;
