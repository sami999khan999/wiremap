import type { FlagMeta } from "../registry/index.js";

// Rolls out hiding a dashboard card. Read by the preference use-cases and by the tray
// widget that names it, then deleted once every org has it — which is the point of a flag.
export const widgetFlags = {
  "widget.dismissal": {
    owner: "sami",
    expiresOn: "2027-03-31",
    description:
      "Lets a user hide a dismissible dashboard card, and an org admin hide one for everyone",
  },
} as const satisfies Record<string, FlagMeta>;
