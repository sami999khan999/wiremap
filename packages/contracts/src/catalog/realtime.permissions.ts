import type { PermissionKey } from "../import.js";

// `core.realtime.subscribe` rather than a slice key: the stream carries whatever the
// frames carry, and every one of those was authorised where it was produced.
export const realtimeProcedurePermissions = {
  "realtime.stream": "core.realtime.subscribe",
} as const satisfies Record<string, PermissionKey>;
