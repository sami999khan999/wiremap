import type { PaginationQuery } from "../import.js";
import type { Authorizer, Principal } from "../primitive/index.js";
import type { ProjectRecord, ProjectRepository } from "./project.repository.js";

export interface ProjectPage {
  readonly items: readonly ProjectRecord[];
  readonly total: number;
}

// Only what the viewer may read. A restricted project they hold no grant on is absent, not
// greyed out: "not yours is not found", as the docs slice decided.
export class ListProjectsUseCase {
  public constructor(
    private readonly authorizer: Authorizer,
    private readonly projects: ProjectRepository,
  ) {}

  public async execute(actor: Principal, page: PaginationQuery): Promise<ProjectPage> {
    this.authorizer.assert(actor, "member.read");
    const readable = (await this.projects.listAll(actor.organizationId)).filter((project) =>
      actor.can("project.graph.read", project.id),
    );
    return { items: readable.slice(page.offset, page.offset + page.limit), total: readable.length };
  }
}
