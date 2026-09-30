import type { RoutePath } from "./index.js";

export const widgetRoutes = {
  defaults: "/settings/widgets",
} as const satisfies Record<string, RoutePath>;
