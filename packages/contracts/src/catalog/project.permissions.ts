import type { PermissionKey } from "../import.js";

// The project's own id is in the input, so the use-case checks the goal-scoped key against
// it; these entries say which key that is.
export const projectProcedurePermissions = {
  "project.list": "member.read",
  "project.get": "project.graph.read",
  "project.create": "project.create",
  "project.update": "project.settings.manage",
  "project.remove": "project.delete",
  "project.available": "project.create",
  "project.addRepository": "project.settings.manage",
  "project.updateRepository": "project.settings.manage",
  "project.removeRepository": "project.settings.manage",
  "project.access": "project.access.manage",
  "project.saveGrant": "project.access.manage",
  "project.revokeGrant": "project.access.manage",
  "project.accessOverview": "project.access.overview",
  "github.status": "project.create",
  "scan.list": "project.graph.read",
  "scan.run": "project.scan.run",
  "scan.createUpload": "project.scan.run",
  "scan.graph": "project.graph.read",
  "view.list": "project.graph.read",
  "view.save": "project.graph.read",
  "view.remove": "project.graph.read",
} as const satisfies Record<string, PermissionKey>;
