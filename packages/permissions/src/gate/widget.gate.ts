import type { ModuleGate } from "../registry/index.js";
import { ROUTES } from "../route/index.js";

export const widgetGates = {
  widget: { permission: "widget.default.manage", route: ROUTES.widget.defaults },
} as const satisfies Record<string, ModuleGate>;
