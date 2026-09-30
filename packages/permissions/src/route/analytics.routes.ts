import type { RoutePath } from "./index.js";

export const analyticsRoutes = {
  activity: "/analytics",
} as const satisfies Record<string, RoutePath>;
