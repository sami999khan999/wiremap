import type { PermissionKey } from "../import.js";

// `core.realtime.subscribe` rather than a slice key: the stream carries whatever the
// frames carry, and every one of those was authorised where it was produced.
export const realtimeProcedurePermissions = {
  "realtime.stream": "core.realtime.subscribe",
  // Membership is the use-case's check; this is the permission to read conversations at all.
  "realtime.conversation": "messaging.conversation.read",
} as const satisfies Record<string, PermissionKey>;
