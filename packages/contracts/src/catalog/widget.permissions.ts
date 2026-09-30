import type { PermissionKey } from "../import.js";

// One entry per path in `WidgetProcedures`. Your own preferences are `core`, held by
// everyone; another member's are the inspector's key.
export const widgetProcedurePermissions = {
  "widget.preferences": "core.widget.customize",
  "widget.preferencesOf": "rbac.effective.inspect",
  "widget.updatePreference": "core.widget.customize",
  "widget.updateDefault": "widget.default.manage",
} as const satisfies Record<string, PermissionKey>;
