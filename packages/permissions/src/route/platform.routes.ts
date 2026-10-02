import type { PermissionKey } from "../registry/permission-registry.js";
import type { RoutePath } from "./index.js";

export const platformRoutes = {
  // Forwards to the first page below the reader may open, so a staff role holding only
  // account access still has somewhere to land.
  home: "/platform",
  status: "/platform/status",
  flags: "/platform/flags",
  entitlements: "/platform/entitlements",
  accounts: "/platform/accounts",
} as const satisfies Record<string, RoutePath>;

// The key each page's guard asks for, and the platform menu's too, so the two cannot drift.
// Every page but `home` must have one, or this fails to compile.
export const platformRoutePermission = {
  status: "platform.status.read",
  accounts: "platform.account.read",
  entitlements: "platform.entitlement.read",
  flags: "platform.flag.read",
} as const satisfies Record<Exclude<keyof typeof platformRoutes, "home">, PermissionKey>;
