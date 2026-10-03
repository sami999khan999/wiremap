import type { RoutePath } from "./index.js";

// `/p/$project` is a project's own page; `/p` is how a parameterised path is declared.
export const projectRoutes = {
  list: "/projects",
  create: "/projects/new",
  show: "/p",
} as const satisfies Record<string, RoutePath>;
