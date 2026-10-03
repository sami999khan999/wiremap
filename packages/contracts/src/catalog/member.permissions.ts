import type { PermissionKey } from "../import.js";

// One entry per path in `MemberProcedures`. Every write is gated on `member.invite`:
// a role that can send an invitation must be able to take it back.
export const memberProcedurePermissions = {
  "member.list": "member.read",
  "member.listInvitations": "member.read",
  "member.invite": "member.invite",
  "member.revokeInvitation": "member.invite",
  // The same key as `invite`, because it is the same act: a new token to the same
  // address. A separate key would be a permission nobody can explain.
  "member.resendInvitation": "member.invite",
  "member.changeRole": "member.role.change",
  // Both on `member.deactivate`: a role that can remove someone's access must be able
  // to give it back, or an accident needs an owner to undo it.
  "member.deactivate": "member.deactivate",
  "member.reactivate": "member.deactivate",
  "member.remove": "member.remove",
  // Links are invitations without an address, so they are the same act as `invite`.
  "member.listLinks": "member.invite",
  "member.createLink": "member.invite",
  "member.revokeLink": "member.invite",
  "member.listDomains": "member.read",
  "member.addDomain": "member.domain.manage",
  "member.removeDomain": "member.domain.manage",
} as const satisfies Record<string, PermissionKey>;
