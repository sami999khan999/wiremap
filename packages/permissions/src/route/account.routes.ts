import type { RoutePath } from "./index.js";

// No permission key and no gate: "may I change my own password?" is not a capability
// anyone can be denied, so the session check on the layout is the whole gate.
export const accountRoutes = {
  // The container. It renders nothing and redirects to `profile`, which is what a
  // reader who trims one segment off `/settings/roles` should get instead of a 404.
  settings: "/settings",
  security: "/settings/security",
  profile: "/settings/account",
} as const satisfies Record<string, RoutePath>;
