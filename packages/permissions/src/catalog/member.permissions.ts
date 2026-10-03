import type { PermissionMeta } from "../registry/index.js";

// Its own fragment and its own module, because the key says so: the grammar is
// `<module>.<subject>.<action>` and these opened `member.` while declaring `rbac`.
export const memberPermissions = {
  "member.read": { scope: "org", module: "member", label: "View members" },
  "member.invite": {
    scope: "org",
    module: "member",
    label: "Invite members",
    requires: ["member.read", "rbac.role.read"],
  },
  "member.deactivate": {
    scope: "org",
    module: "member",
    label: "Deactivate members",
    requires: ["member.read"],
  },
  // Separate from `deactivate`: removing someone's access and changing what they may do
  // are different powers, and a role that can do one need not do the other.
  "member.role.change": {
    scope: "org",
    module: "member",
    label: "Change a member's role",
    requires: ["member.read", "rbac.role.read"],
  },
  // Ends the membership outright, where `deactivate` keeps it switchable back. A key of its
  // own: a role that may pause someone need not be able to make them leave.
  "member.remove": {
    scope: "org",
    module: "member",
    label: "Remove members",
    requires: ["member.read"],
  },
  // Teams are groups of members that projects are shared with, not roles: belonging to
  // one grants nothing until a project names it.
  "member.team.manage": {
    scope: "org",
    module: "member",
    label: "Manage teams",
    requires: ["member.read"],
  },
  // Who joins on their own: anyone with a verified address at a claimed domain arrives
  // with the role chosen here, so it needs the same reading of roles an invitation does.
  "member.domain.manage": {
    scope: "org",
    module: "member",
    label: "Manage auto-join domains",
    requires: ["member.read", "rbac.role.read"],
  },
} as const satisfies Record<string, PermissionMeta>;
