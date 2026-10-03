import { NotFoundError } from "../import.js";
import type { Principal } from "../primitive/index.js";
import type { ProjectRecord, ProjectRepository } from "./project.repository.js";

// NOT_FOUND for a project the viewer may not read, never FORBIDDEN: a restricted project's
// slug is not something a stranger should be able to confirm.
export class GetProjectUseCase {
  public constructor(private readonly projects: ProjectRepository) {}

  public async execute(actor: Principal, input: { readonly slug: string }): Promise<ProjectRecord> {
    const project = await this.projects.findBySlug(actor.organizationId, input.slug);
    if (!project || !actor.can("project.graph.read", project.id))
      throw new NotFoundError("project", input.slug);
    return project;
  }
}
