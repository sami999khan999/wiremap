import type { RoutePath } from "./index.js";

// No permission key and no gate, as `accountRoutes` has none: founding a tenant of your
// own is not a capability anyone in *another* tenant can grant or deny.
export const organizationRoutes = {
  create: "/organization/new",
  // Gated, unlike `create`: renaming, handing over and deleting a tenant are its own acts.
  settings: "/settings/organization",
  // Where a shareable invitation link lands, signed in or not.
  join: "/join",
} as const satisfies Record<string, RoutePath>;
