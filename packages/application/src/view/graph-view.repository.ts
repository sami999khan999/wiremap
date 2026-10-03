import type { GraphViewId, OrganizationId, ProjectId, UserId } from "../import.js";

export interface GraphViewRecord {
  readonly id: GraphViewId;
  readonly projectId: ProjectId;
  readonly name: string;
  readonly state: string;
  readonly createdBy: UserId;
  readonly createdAt: Date;
}

// A project's saved explorer views. Tenant rows, routed with the tenant's other data.
export abstract class GraphViewRepository {
  public abstract list(
    organizationId: OrganizationId,
    projectId: ProjectId,
  ): Promise<readonly GraphViewRecord[]>;

  public abstract findById(
    organizationId: OrganizationId,
    id: GraphViewId,
  ): Promise<GraphViewRecord | null>;

  public abstract save(
    organizationId: OrganizationId,
    view: Omit<GraphViewRecord, "createdAt">,
  ): Promise<void>;

  public abstract remove(organizationId: OrganizationId, id: GraphViewId): Promise<void>;

  // Deleting a project sweeps its views, which hold no key to the catalog's projects.
  public abstract removeForProject(
    organizationId: OrganizationId,
    projectId: ProjectId,
  ): Promise<void>;
}
