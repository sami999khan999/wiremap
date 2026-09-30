import type { PermissionKey } from "../import.js";

// One entry per path in `RoleProcedures`. A procedure with no entry is denied rather
// than allowed, and the coverage test fails before it can ship.
export const roleProcedurePermissions = {
  "role.list": "rbac.role.read",
  "role.effective": "rbac.effective.inspect",
  // Read with the roles: the ceiling is what the role list is drawn against.
  "role.entitlement": "rbac.role.read",
  "role.create": "rbac.role.manage",
  "role.update": "rbac.role.manage",
  "role.remove": "rbac.role.manage",
  // Grant and revoke split, because they are not the same risk: handing a permission out
  // is the one that widens what someone can do, and a product that separates them can.
  "role.grant": "rbac.permission.grant",
  "role.revoke": "rbac.permission.revoke",
} as const satisfies Record<string, PermissionKey>;
