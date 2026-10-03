import {
  ForbiddenError,
  type GraphViewId,
  NotFoundError,
  type ProjectId,
  Uuid,
} from "../import.js";
import type { Authorizer, Principal } from "../primitive/index.js";
import { ProjectAccess, type ProjectRepository } from "../project/index.js";
import type { GraphViewRecord, GraphViewRepository } from "./graph-view.repository.js";

// A project's saved views: anyone who can read the project can list and save them; a view
// is removed by its author, or by whoever manages the project's settings.
export class ManageViewsUseCase {
  private static readonly MAX_PER_PROJECT = 100;

  public constructor(
    private readonly authorizer: Authorizer,
    private readonly projects: ProjectRepository,
    private readonly views: GraphViewRepository,
  ) {}

  public async list(actor: Principal, projectId: ProjectId): Promise<readonly GraphViewRecord[]> {
    const project = await ProjectAccess.load(
      this.authorizer,
      this.projects,
      actor,
      projectId,
      "project.graph.read",
    );
    return this.views.list(actor.organizationId, project.id);
  }

  public async save(
    actor: Principal,
    input: { readonly projectId: ProjectId; readonly name: string; readonly state: string },
  ): Promise<GraphViewRecord> {
    const project = await ProjectAccess.load(
      this.authorizer,
      this.projects,
      actor,
      input.projectId,
      "project.graph.read",
    );
    const existing = await this.views.list(actor.organizationId, project.id);
    if (existing.length >= ManageViewsUseCase.MAX_PER_PROJECT)
      throw new ForbiddenError("project.graph.read");
    const id = Uuid.v7() as GraphViewId;
    // Only the query string: anything else in it would be the URL of somewhere else.
    const state = input.state.replace(/^\?/, "").replace(/[#\s].*$/, "");
    await this.views.save(actor.organizationId, {
      id,
      projectId: project.id,
      name: input.name.trim(),
      state,
      createdBy: actor.userId,
    });
    const saved = await this.views.findById(actor.organizationId, id);
    if (!saved) throw new NotFoundError("view", id);
    return saved;
  }

  public async remove(
    actor: Principal,
    input: { readonly projectId: ProjectId; readonly viewId: GraphViewId },
  ): Promise<void> {
    const project = await ProjectAccess.load(
      this.authorizer,
      this.projects,
      actor,
      input.projectId,
      "project.graph.read",
    );
    const view = await this.views.findById(actor.organizationId, input.viewId);
    if (!view || view.projectId !== project.id) throw new NotFoundError("view", input.viewId);
    if (view.createdBy !== actor.userId)
      this.authorizer.assert(actor, "project.settings.manage", project.id);
    await this.views.remove(actor.organizationId, view.id);
  }
}
