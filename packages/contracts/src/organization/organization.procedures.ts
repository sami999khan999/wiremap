import { oc } from "../import.js";
import { Envelope } from "../primitive/index.js";
import { OrganizationContract } from "./organization.contract.js";

// The active organization, singular: every path is the caller's own tenant, so none
// takes an id a caller could swap for another tenant's.
export class OrganizationProcedures {
  private constructor() {}

  public static readonly get = oc
    .route({ method: "GET", path: "/organization" })
    .input(OrganizationContract.get)
    .output(OrganizationContract.entity);

  public static readonly update = oc
    .route({ method: "PATCH", path: "/organization" })
    .input(OrganizationContract.update)
    .output(OrganizationContract.entity);

  public static readonly transferOwnership = oc
    .route({ method: "POST", path: "/organization/owner" })
    .input(OrganizationContract.transferOwnership)
    .output(Envelope.acknowledged);

  public static readonly remove = oc
    .route({ method: "DELETE", path: "/organization" })
    .input(OrganizationContract.remove)
    .output(Envelope.acknowledged);

  public static readonly all = {
    get: OrganizationProcedures.get,
    update: OrganizationProcedures.update,
    transferOwnership: OrganizationProcedures.transferOwnership,
    remove: OrganizationProcedures.remove,
  } as const;
}
