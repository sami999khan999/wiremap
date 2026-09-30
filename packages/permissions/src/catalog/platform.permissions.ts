import type { PermissionMeta } from "../registry/index.js";

// Above the tenant. Every key here is `scope: "platform"`, which is what keeps it out of
// a tenant owner's `all` and out of the role editor — see docs/reference/platform-scope.md.
export const platformPermissions = {
  "platform.status.read": {
    scope: "platform",
    module: "platform",
    label: "View platform status",
  },
  // Routes the worker's batch reads to a standby — `24.3`. Manage only: whether one
  // exists and how far behind it is shows on the status page under `status.read`.
  "platform.replica.manage": {
    scope: "platform",
    module: "platform",
    label: "Route reads to the replica",
    requires: ["platform.status.read"],
  },
  // Every flag, server-only ones included: the only place those names leave the server.
  "platform.flag.read": {
    scope: "platform",
    module: "platform",
    label: "View feature flags",
  },
  "platform.flag.manage": {
    scope: "platform",
    module: "platform",
    label: "Switch feature flags",
    requires: ["platform.flag.read"],
  },
  "platform.entitlement.read": {
    scope: "platform",
    module: "platform",
    label: "View plans and entitlements",
  },
  "platform.entitlement.manage": {
    scope: "platform",
    module: "platform",
    label: "Edit plans and adjust what an organization is entitled to",
    requires: ["platform.entitlement.read"],
  },
  // The incident switch, on the status page: which modules are down is read as status.
  "platform.module.manage": {
    scope: "platform",
    module: "platform",
    label: "Switch a module off for every organization",
    requires: ["platform.status.read"],
  },
  "platform.tenant.manage": {
    scope: "platform",
    module: "platform",
    label: "Delete and export a tenant",
  },
  // `account`, not `principal`: a `Principal` is the per-request class, and these act on
  // the `users` row every tenant shares.
  "platform.account.read": {
    scope: "platform",
    module: "platform",
    label: "Look up an account across organizations",
  },
  "platform.account.manage": {
    scope: "platform",
    module: "platform",
    label: "Suspend an account, and deny one person a permission",
    requires: ["platform.account.read"],
  },
  // Who outside the platform may read a `granted` doc space. Writing the docs themselves
  // is the tenant `doc.*` keys, held in the platform organization like any other.
  "platform.doc.grant": {
    scope: "platform",
    module: "platform",
    label: "Grant organizations, people and plans access to private docs",
  },
} as const satisfies Record<string, PermissionMeta>;
