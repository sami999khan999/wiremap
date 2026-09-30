import type { WidgetMeta } from "../registry/index.js";

// Inline: it lives in the header, not a zone, so it is placed by a literal key and cannot
// be dismissed — preferences load with a zone's route, and the header has none.
export const notificationWidgets = {
  "notification.bell": { permission: "notification.inbox.read" },
} as const satisfies Record<string, WidgetMeta>;
