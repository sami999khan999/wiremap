import type { WidgetMeta } from "../registry/index.js";

export const memberWidgets = {
  "member.count": {
    zone: "dashboard.main",
    permission: "member.read",
    policy: "dismissible",
    order: 20,
  },
} as const satisfies Record<string, WidgetMeta>;
