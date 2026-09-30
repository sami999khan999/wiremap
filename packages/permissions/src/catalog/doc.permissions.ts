import type { PermissionMeta } from "../registry/index.js";

// Necessary, never sufficient: `DocAccess` also reads the space's audience, and a platform
// space is readable by people who hold none of these. See application/docs/reference/doc.md.
export const docPermissions = {
  "doc.page.read": {
    scope: "org",
    module: "doc",
    label: "Read this organization's docs",
  },
  // Drafts, moves and deletes. A draft is invisible to readers, so writing one is safe to
  // hand out more widely than publishing it.
  "doc.page.write": {
    scope: "org",
    module: "doc",
    label: "Write and edit draft doc pages",
    requires: ["doc.page.read"],
  },
  "doc.page.publish": {
    scope: "org",
    module: "doc",
    label: "Publish doc pages",
    requires: ["doc.page.write"],
  },
  "doc.space.manage": {
    scope: "org",
    module: "doc",
    label: "Create, rename and delete doc spaces",
    requires: ["doc.page.read"],
  },
} as const satisfies Record<string, PermissionMeta>;
