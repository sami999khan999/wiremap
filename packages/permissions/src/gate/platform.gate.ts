import type { ModuleGate } from "../registry/index.js";
import { ROUTES } from "../route/index.js";

// One module for the whole tier. `ModuleRegistry.isVisible` needs no change: it calls
// `can()`, and the platform branch there answers.
export const platformGates = {
  platform: { permission: "platform.status.read", route: ROUTES.platform.status },
} as const satisfies Record<string, ModuleGate>;
