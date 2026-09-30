import type { RoutePath } from "./index.js";

export const platformRoutes = {
  status: "/platform/status",
  flags: "/platform/flags",
  entitlements: "/platform/entitlements",
  accounts: "/platform/accounts",
} as const satisfies Record<string, RoutePath>;
