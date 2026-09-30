import type { RoutePath } from "./index.js";

export const messagingRoutes = {
  inbox: "/messages",
  // The framework's own `$` form rather than a builder. `AppRoute`'s `Extract<…, string>`
  // reserves room for a builder here, and nothing needs one until a `<Link>` does.
  conversation: "/messages/$conversationId",
} as const satisfies Record<string, RoutePath>;
