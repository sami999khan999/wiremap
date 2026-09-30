import type { PermissionMeta } from "../registry/index.js";

// The worker's grants live here rather than in a worker-local list, because a system
// principal naming a permission the catalog does not know must fail at boot (25.3).
export const aiPermissions = {
  "ai.embedding.write": {
    scope: "org",
    module: "ai",
    label: "Index documents for search",
    requires: ["ai.embedding.read"],
  },
  "ai.embedding.read": {
    scope: "org",
    module: "ai",
    label: "Search indexed documents",
  },
} as const satisfies Record<string, PermissionMeta>;
