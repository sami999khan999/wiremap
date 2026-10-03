import {
  PROJECT_ROLES,
  ProjectContract,
  type ProjectDto,
  type ProjectRole,
} from "./project.contract.js";

export class ProjectEntity {
  private constructor(private readonly dto: ProjectDto) {}

  public static from(dto: ProjectDto): ProjectEntity {
    return new ProjectEntity(ProjectContract.entity.parse(dto));
  }

  // The higher of two project roles: `project_admin` outranks `project_editor` outranks
  // `project_viewer`. How a direct grant and a team's grant to one person combine.
  public static higher(left: ProjectRole, right: ProjectRole): ProjectRole {
    return PROJECT_ROLES.indexOf(left) <= PROJECT_ROLES.indexOf(right) ? left : right;
  }

  public get id(): ProjectDto["id"] {
    return this.dto.id;
  }

  public get restricted(): boolean {
    return this.dto.visibility === "restricted";
  }

  // A project with no repository has nothing to scan until a graph is uploaded.
  public get connected(): boolean {
    return this.dto.repositories.some((repository) => repository.provider === "github");
  }
}
