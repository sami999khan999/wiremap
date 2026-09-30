// An admin's hide for everyone. A person's own hide is not audited: it is cosmetic, and
// changes nothing anyone may do.
export const widgetActions = {
  "widget.default.hidden": { label: "Dashboard card hidden for everyone" },
  "widget.default.restored": { label: "Dashboard card shown to everyone again" },
} as const;
