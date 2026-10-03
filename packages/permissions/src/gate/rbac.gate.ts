import type { ModuleGate } from "../registry/index.js";
import { ROUTES } from "../route/index.js";

export const rbacGates = {
  rbac: { permission: "rbac.role.read", route: ROUTES.rbac.roles },
  member: { permission: "member.read", route: ROUTES.rbac.members },
  apikey: { permission: "apikey.read", route: ROUTES.rbac.apiKeys },
  // Listing teams is reading members; managing them is a separate key on the procedures.
  team: { permission: "member.read", route: ROUTES.rbac.teams },
  audit: { permission: "audit.log.read", route: ROUTES.rbac.audit },
} as const satisfies Record<string, ModuleGate>;
