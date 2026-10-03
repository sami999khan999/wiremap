import type { PermissionMeta } from "../registry/index.js";

// The organization itself, as opposed to who is in it. Ownership and deletion are the
// owner's alone: no role but `owner` lists them, and `all` is how the owner holds them.
export const organizationPermissions = {
  "organization.profile.update": {
    scope: "org",
    module: "organization",
    label: "Rename the organization",
  },
  "organization.ownership.transfer": {
    scope: "org",
    module: "organization",
    label: "Transfer ownership",
    requires: ["member.read"],
  },
  "organization.delete": {
    scope: "org",
    module: "organization",
    label: "Delete the organization",
  },
} as const satisfies Record<string, PermissionMeta>;
