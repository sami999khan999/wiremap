import type { FlagMeta } from "../registry/index.js";

// Merged from team-owned fragments. Add them here — `...taskFlags`. Empty in lite: its one
// flag left with widgets, and a flag is a rollout, so none is declared until one is needed.
export const FLAGS = {} as const satisfies Record<string, FlagMeta>;
