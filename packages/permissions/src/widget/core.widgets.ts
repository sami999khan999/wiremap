import type { WidgetMeta } from "../registry/index.js";

// Required and ungated: the nav is the last path to every capability, so hiding a card
// can never remove the only way in. See docs/reference/widget-registry.md.
export const coreWidgets = {
  "core.module-nav": { zone: "dashboard.main", permission: null, order: 10 },
  // The tray a hidden card goes to, so hiding is never a one-way door. Behind the rollout
  // flag, which is what puts `widget.dismissal` in the session for an org that has it.
  "core.hidden-widgets": {
    zone: "dashboard.main",
    permission: "core.widget.customize",
    flag: "widget.dismissal",
    order: 90,
  },
} as const satisfies Record<string, WidgetMeta>;
