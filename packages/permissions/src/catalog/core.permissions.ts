import type { PermissionMeta } from "../registry/index.js";

// Held by every resolved principal, in `CapabilitySet.can()` rather than through a role —
// a role that granted it could be missing it. See docs/reference/capability-set.md.
export const corePermissions = {
  "core.activity.write": {
    scope: "org",
    module: "core",
    label: "Write audit entries",
  },
  // Every signed-in principal, because the stream is the transport and each frame on it
  // was authorised where it was produced. Gating it again would gate the wrong thing.
  "core.realtime.subscribe": {
    scope: "org",
    module: "core",
    label: "Receive real-time updates",
  },
} as const satisfies Record<string, PermissionMeta>;
