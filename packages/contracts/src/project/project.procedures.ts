import { oc, z } from "../import.js";
import { Envelope } from "../primitive/index.js";
import { ProjectContract } from "./project.contract.js";

export class ProjectProcedures {
  private constructor() {}

  // Only the projects the caller may read, filtered on the server.
  public static readonly list = oc
    .route({ method: "GET", path: "/projects" })
    .input(ProjectContract.listQuery)
    .output(Envelope.paginated(ProjectContract.entity));

  public static readonly get = oc
    .route({ method: "GET", path: "/projects/by-slug/{slug}" })
    .input(ProjectContract.bySlug)
    .output(ProjectContract.entity);

  public static readonly create = oc
    .route({ method: "POST", path: "/projects" })
    .input(ProjectContract.create)
    .output(ProjectContract.entity);

  public static readonly update = oc
    .route({ method: "PATCH", path: "/projects/{projectId}" })
    .input(ProjectContract.update)
    .output(ProjectContract.entity);

  public static readonly remove = oc
    .route({ method: "DELETE", path: "/projects/{projectId}" })
    .input(ProjectContract.ref)
    .output(Envelope.acknowledged);

  public static readonly available = oc
    .route({ method: "GET", path: "/projects/available-repositories" })
    .input(z.object({}))
    .output(ProjectContract.available.array().readonly());

  public static readonly addRepository = oc
    .route({ method: "POST", path: "/projects/{projectId}/repositories" })
    .input(ProjectContract.addRepository)
    .output(ProjectContract.entity);

  public static readonly updateRepository = oc
    .route({ method: "PATCH", path: "/projects/{projectId}/repositories/{repositoryId}" })
    .input(ProjectContract.updateRepository)
    .output(ProjectContract.entity);

  public static readonly removeRepository = oc
    .route({ method: "DELETE", path: "/projects/{projectId}/repositories/{repositoryId}" })
    .input(ProjectContract.removeRepository)
    .output(ProjectContract.entity);

  public static readonly access = oc
    .route({ method: "GET", path: "/projects/{projectId}/access" })
    .input(ProjectContract.ref)
    .output(ProjectContract.grant.array().readonly());

  public static readonly saveGrant = oc
    .route({ method: "PUT", path: "/projects/{projectId}/access" })
    .input(ProjectContract.saveGrant)
    .output(ProjectContract.grant);

  public static readonly revokeGrant = oc
    .route({ method: "DELETE", path: "/projects/{projectId}/access/{grantId}" })
    .input(ProjectContract.revokeGrant)
    .output(Envelope.acknowledged);

  public static readonly accessOverview = oc
    .route({ method: "GET", path: "/projects/access-overview" })
    .input(z.object({}))
    .output(ProjectContract.accessOverview);

  public static readonly all = {
    list: ProjectProcedures.list,
    get: ProjectProcedures.get,
    create: ProjectProcedures.create,
    update: ProjectProcedures.update,
    remove: ProjectProcedures.remove,
    available: ProjectProcedures.available,
    addRepository: ProjectProcedures.addRepository,
    updateRepository: ProjectProcedures.updateRepository,
    removeRepository: ProjectProcedures.removeRepository,
    access: ProjectProcedures.access,
    saveGrant: ProjectProcedures.saveGrant,
    revokeGrant: ProjectProcedures.revokeGrant,
    accessOverview: ProjectProcedures.accessOverview,
  } as const;
}
