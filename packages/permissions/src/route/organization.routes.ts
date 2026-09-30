import type { RoutePath } from "./index.js";

// No permission key and no gate, as `accountRoutes` has none: founding a tenant of your
// own is not a capability anyone in *another* tenant can grant or deny.
export const organizationRoutes = {
  create: "/organization/new",
} as const satisfies Record<string, RoutePath>;
