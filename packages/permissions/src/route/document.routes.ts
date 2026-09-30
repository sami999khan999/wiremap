import type { RoutePath } from "./index.js";

export const documentRoutes = {
  index: "/documents",
} as const satisfies Record<string, RoutePath>;
