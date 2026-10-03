import {
  and,
  asc,
  eq,
  type GraphViewId,
  type GraphViewRecord,
  type GraphViewRepository,
  type OrganizationId,
  type Placement,
  type ProjectId,
} from "../../import.js";
import { BaseRepository } from "../primitive/index.js";
import { graphViews } from "../schema/index.js";

export class PgGraphViewRepository extends BaseRepository implements GraphViewRepository {
  protected override readonly placement: Placement = "routed";

  public async list(
    organizationId: OrganizationId,
    projectId: ProjectId,
  ): Promise<readonly GraphViewRecord[]> {
    return this.db
      .select()
      .from(graphViews)
      .where(
        and(eq(graphViews.organizationId, organizationId), eq(graphViews.projectId, projectId)),
      )
      .orderBy(asc(graphViews.name));
  }

  public async findById(
    organizationId: OrganizationId,
    id: GraphViewId,
  ): Promise<GraphViewRecord | null> {
    const [row] = await this.db
      .select()
      .from(graphViews)
      .where(and(eq(graphViews.organizationId, organizationId), eq(graphViews.id, id)))
      .limit(1);
    return row ?? null;
  }

  public async save(
    organizationId: OrganizationId,
    view: Omit<GraphViewRecord, "createdAt">,
  ): Promise<void> {
    await this.db.insert(graphViews).values({ ...view, organizationId });
  }

  public async remove(organizationId: OrganizationId, id: GraphViewId): Promise<void> {
    await this.db
      .delete(graphViews)
      .where(and(eq(graphViews.organizationId, organizationId), eq(graphViews.id, id)));
  }

  public async removeForProject(
    organizationId: OrganizationId,
    projectId: ProjectId,
  ): Promise<void> {
    await this.db
      .delete(graphViews)
      .where(
        and(eq(graphViews.organizationId, organizationId), eq(graphViews.projectId, projectId)),
      );
  }
}
