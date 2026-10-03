import { PROJECT_ROLES, type ProjectRole } from "../import.js";

// What a project role means, in one place: the capability read and the access panel must
// agree on which of two grants wins and what a viewer is capped at.
export class ProjectRules {
  private constructor() {}

  // The organization role whose project role is capped at reading, wherever it comes from.
  public static readonly READ_ONLY_ORG_ROLE = "viewer";

  public static readonly DEFAULT_IGNORE: readonly string[] = Object.freeze([
    "node_modules",
    "dist",
    "build",
    ".next",
    ".output",
    "vendor",
    "coverage",
  ]);

  // Every object a project owns sits under this prefix, so deleting it is one sweep.
  public static storagePrefix(organizationId: string, projectId: string): string {
    return `graphs/${organizationId}/${projectId}/`;
  }

  // The higher of two: `project_admin` outranks `project_editor` outranks `project_viewer`.
  public static higher(left: ProjectRole, right: ProjectRole): ProjectRole {
    return PROJECT_ROLES.indexOf(left) <= PROJECT_ROLES.indexOf(right) ? left : right;
  }

  // A viewer's reach into any project, however it was granted, is reading it.
  public static capped(role: ProjectRole, orgRoleKey: string): ProjectRole {
    return orgRoleKey === ProjectRules.READ_ONLY_ORG_ROLE ? "project_viewer" : role;
  }
}
