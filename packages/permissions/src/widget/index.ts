import { coreWidgets } from "./core.widgets.js";
import { memberWidgets } from "./member.widgets.js";
import { notificationWidgets } from "./notification.widgets.js";

// Merged from team-owned fragments. Add them here — `...taskWidgets`.
export const WIDGETS = {
  ...coreWidgets,
  ...memberWidgets,
  ...notificationWidgets,
} as const;
