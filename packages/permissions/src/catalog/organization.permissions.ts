import type { PermissionMeta } from "../registry/index.js";

// The organization itself, as opposed to who is in it. Ownership and deletion are the
// owner's alone: no role but `owner` lists them, and `all` is how the owner holds them.
export const organizationPermissions = {
  "organization.profile.update": {
    scope: "org",
    module: "organization",
    label: "Rename the organization",
  },
  // The organization's own model key for Ask: written once, never read back.
  "organization.ai.manage": {
    scope: "org",
    module: "organization",
    label: "Manage AI settings",
  },
  // Where scan and finding events are sent off the platform: a URL, a secret, a Slack hook.
  "organization.webhook.manage": {
    scope: "org",
    module: "organization",
    label: "Manage webhooks",
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
