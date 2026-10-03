import type { ProjectId } from "../import.js";
import type { UserReader } from "../port/index.js";
import type { Authorizer, Principal } from "../primitive/index.js";
import { ProjectAccess, type ProjectRepository } from "../project/index.js";
import type { ActivityPage, ActivityReader } from "./activity.reader.js";

// One project's feed: the trail rows whose payload names it. Anyone who reads the project
// reads its feed, which is why this is not the audit log's `audit.log.read`.
export class ListProjectActivityUseCase {
  public constructor(
    private readonly authorizer: Authorizer,
    private readonly projects: ProjectRepository,
    private readonly reader: ActivityReader,
    private readonly users: UserReader,
  ) {}

  public async execute(
    actor: Principal,
    query: { readonly projectId: ProjectId; readonly cursor?: string; readonly limit: number },
  ): Promise<ActivityPage> {
    const project = await ProjectAccess.load(
      this.authorizer,
      this.projects,
      actor,
      query.projectId,
      "project.graph.read",
    );
    const page = await this.reader.list(actor.organizationId, {
      projectId: project.id,
      limit: query.limit,
      ...(query.cursor ? { cursor: query.cursor } : {}),
    });
    const names = await this.users.namesOf(actor.organizationId, [
      ...new Set(page.items.map((item) => item.actorId)),
    ]);
    return {
      ...page,
      items: page.items.map((item) => ({ ...item, actorName: names.get(item.actorId) ?? null })),
    };
  }
}
