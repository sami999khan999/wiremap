import { z } from "../import.js";
import { Identifiers } from "../primitive/index.js";

// Past tense, always: a permission is a right you hold, an event is a fact that happened.
// The payload is what a subscriber needs and no more — never the whole row.
export const memberEvents = {
  "member.invited": z.object({
    invitationId: Identifiers.invitationId,
    email: z.email(),
    roleId: Identifiers.roleId,
    // The token is deliberately absent. `invitations` stores only its hash so a dump of
    // that table accepts nothing; an event carrying it would hand it straight back.
    invitedBy: Identifiers.userId,
  }),
  "member.joined": z.object({
    userId: Identifiers.userId,
    roleId: Identifiers.roleId,
  }),
  "member.role.changed": z.object({
    userId: Identifiers.userId,
    roleId: Identifiers.roleId,
    previousRoleId: Identifiers.roleId,
  }),
} as const;
