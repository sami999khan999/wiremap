import type { ModuleGate } from "../registry/index.js";
import { ROUTES } from "../route/index.js";

// Gated on reading members, not on a project key: a module gate cannot be goal-scoped, and
// the list it opens filters itself to the projects the viewer may read.
export const projectGates = {
  project: { permission: "member.read", route: ROUTES.project.list },
} as const satisfies Record<string, ModuleGate>;
