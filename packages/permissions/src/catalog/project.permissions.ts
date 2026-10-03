import type { PermissionMeta } from "../registry/index.js";

// A project is a goal in the kit's sense: its keys are `goal`-scoped, held per project
// through a project role, and held for every project by an org role that lists them.
export const projectPermissions = {
  // Organization-wide: who may connect repositories and start a project at all.
  "project.create": {
    scope: "org",
    module: "project",
    label: "Create projects",
    requires: ["member.read"],
  },
  // Organization-wide too: the access overview reads every project's grants at once, and a
  // module cannot be gated on a goal-scoped key.
  "project.access.overview": {
    scope: "org",
    module: "project",
    label: "See who can open every project",
    requires: ["member.read"],
  },
  "project.graph.read": {
    scope: "goal",
    module: "project",
    label: "View a project's graph",
  },
  // Editor and up: starting a scan spends the organization's runner minutes.
  "project.scan.run": {
    scope: "goal",
    module: "project",
    label: "Scan a project",
    requires: ["project.graph.read"],
  },
  // Every role that reads a project may ask about it; the organization's key pays for it.
  "project.ask.use": {
    scope: "goal",
    module: "project",
    label: "Ask about a project",
    requires: ["project.graph.read"],
  },
  "project.settings.manage": {
    scope: "goal",
    module: "project",
    label: "Change a project's settings and repositories",
    requires: ["project.graph.read"],
  },
  "project.access.manage": {
    scope: "goal",
    module: "project",
    label: "Choose who can see a project",
    requires: ["project.graph.read"],
  },
  "project.delete": {
    scope: "goal",
    module: "project",
    label: "Delete a project",
    requires: ["project.graph.read"],
  },
} as const satisfies Record<string, PermissionMeta>;
