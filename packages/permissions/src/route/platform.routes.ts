import type { RoutePath } from "./index.js";

export const platformRoutes = {
  status: "/platform/status",
  retention: "/platform/retention",
  analytics: "/platform/analytics",
  storage: "/platform/storage",
  shards: "/platform/shards",
  flags: "/platform/flags",
  entitlements: "/platform/entitlements",
  accounts: "/platform/accounts",
} as const satisfies Record<string, RoutePath>;
