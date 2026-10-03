import type { ModuleGate } from "../registry/index.js";
import { ROUTES } from "../route/index.js";

export const organizationGates = {
  organization: { permission: "organization.profile.update", route: ROUTES.organization.settings },
} as const satisfies Record<string, ModuleGate>;
