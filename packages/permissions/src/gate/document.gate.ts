import type { ModuleGate } from "../registry/index.js";
import { ROUTES } from "../route/index.js";

export const documentGates = {
  // Gated on the *read* key: a member who can search the corpus should see the menu
  // entry, whether or not they may add to it.
  document: { permission: "ai.embedding.read", route: ROUTES.document.index },
} as const satisfies Record<string, ModuleGate>;
