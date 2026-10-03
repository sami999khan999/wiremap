import type { PermissionKey } from "../import.js";

// Reading the profile is reading members' context; changing it is the profile key, and
// handing it over or deleting it is the owner's alone.
export const organizationProcedurePermissions = {
  "organization.get": "member.read",
  "organization.update": "organization.profile.update",
  "organization.transferOwnership": "organization.ownership.transfer",
  "organization.remove": "organization.delete",
} as const satisfies Record<string, PermissionKey>;
