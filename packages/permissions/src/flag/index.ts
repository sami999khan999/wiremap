import { widgetFlags } from "./widget.flags.js";

// Merged from team-owned fragments. Add them here — `...taskFlags`.
export const FLAGS = {
  ...widgetFlags,
} as const;
