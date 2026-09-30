import type { ModuleGate } from "../registry/index.js";
import { ROUTES } from "../route/index.js";

// On `read`: anyone who can open a page needs the menu entry, whether or not they write.
export const docGates = {
  doc: { permission: "doc.page.read", route: ROUTES.doc.home },
} as const satisfies Record<string, ModuleGate>;
