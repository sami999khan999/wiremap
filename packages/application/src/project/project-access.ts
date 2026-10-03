import { NotFoundError, type ProjectId } from "../import.js";
import type { Authorizer, Principal } from "../primitive/index.js";
import type { ProjectRecord, ProjectRepository } from "./project.repository.js";

// The load-then-assert every project write does: unreadable is NOT_FOUND, readable but not
// permitted is FORBIDDEN. One place, so no write forgets the first half.
export class ProjectAccess {
  private constructor() {}

  public static async load(
    authorizer: Authorizer,
    projects: ProjectRepository,
    actor: Principal,
    projectId: ProjectId,
    permission: Parameters<Principal["can"]>[0],
  ): Promise<ProjectRecord> {
    const project = await projects.findById(actor.organizationId, projectId);
    if (!project || !actor.can("project.graph.read", project.id))
      throw new NotFoundError("project", projectId);
    authorizer.assert(actor, permission, project.id);
    return project;
  }
}
