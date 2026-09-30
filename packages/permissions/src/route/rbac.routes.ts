import type { RoutePath } from "./index.js";

export const rbacRoutes = {
  roles: "/settings/roles",
  members: "/settings/members",
  apiKeys: "/settings/api-keys",
} as const satisfies Record<string, RoutePath>;
