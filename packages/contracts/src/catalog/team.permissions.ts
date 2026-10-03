import type { PermissionKey } from "../import.js";

// Seeing teams is seeing members; shaping them is its own key.
export const teamProcedurePermissions = {
  "team.list": "member.read",
  "team.members": "member.read",
  "team.create": "member.team.manage",
  "team.update": "member.team.manage",
  "team.remove": "member.team.manage",
  "team.addMember": "member.team.manage",
  "team.removeMember": "member.team.manage",
} as const satisfies Record<string, PermissionKey>;
