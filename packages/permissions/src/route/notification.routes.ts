import type { RoutePath } from "./index.js";

export const notificationRoutes = {
  inbox: "/notifications",
  preferences: "/settings/notifications",
} as const satisfies Record<string, RoutePath>;
