import type { RoutePath } from "./index.js";

export const rbacRoutes = {
  roles: "/settings/roles",
  members: "/settings/members",
  apiKeys: "/settings/api-keys",
  teams: "/settings/teams",
  audit: "/settings/audit",
} as const satisfies Record<string, RoutePath>;
