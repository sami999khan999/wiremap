import type { PermissionMeta } from "../registry/index.js";

// Its own module, not `core`: every key in `core` is held by everyone, and hiding a card for
// the whole organization is an administrator's decision (`RV.12`).
export const widgetPermissions = {
  "widget.default.manage": {
    scope: "org",
    module: "widget",
    label: "Hide dashboard cards for everyone in the organization",
  },
} as const satisfies Record<string, PermissionMeta>;
