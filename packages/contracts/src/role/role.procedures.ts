import { oc } from "../import.js";
import { Envelope } from "../primitive/index.js";
import { RoleContract } from "./role.contract.js";

export class RoleProcedures {
  private constructor() {}

  public static readonly list = oc
    .route({ method: "GET", path: "/roles" })
    .input(RoleContract.listQuery)
    .output(Envelope.paginated(RoleContract.entity));

  // Someone else's effective permissions, which is a different question from the
  // viewer's own — that one is answered from the session with no round trip.
  public static readonly effective = oc
    .route({ method: "GET", path: "/roles/effective/{userId}" })
    .input(RoleContract.inspect)
    .output(RoleContract.effective);

  // The org's ceiling: every key its plan lets through. The role editor greys the rest
  // rather than hiding them, so an admin sees what an upgrade would bring back.
  public static readonly entitlement = oc
    .route({ method: "GET", path: "/roles/entitlement" })
    .output(RoleContract.entitlement);

  public static readonly create = oc
    .route({ method: "POST", path: "/roles" })
    .input(RoleContract.create)
    .output(RoleContract.entity);

  // `PATCH`, not `PUT`: the body carries the two editable fields, and the grants are
  // not the caller's to restate on a rename.
  public static readonly update = oc
    .route({ method: "PATCH", path: "/roles/{roleId}" })
    .input(RoleContract.update)
    .output(RoleContract.entity);

  public static readonly remove = oc
    .route({ method: "DELETE", path: "/roles/{roleId}" })
    .input(RoleContract.remove)
    .output(Envelope.acknowledged);

  // Both return the whole role rather than an acknowledgement: the matrix re-renders a
  // row from the response, and a bare `{ ok: true }` would make it guess.
  public static readonly grant = oc
    .route({ method: "POST", path: "/roles/{roleId}/permissions" })
    .input(RoleContract.changePermission)
    .output(RoleContract.entity);

  public static readonly revoke = oc
    .route({ method: "DELETE", path: "/roles/{roleId}/permissions/{permission}" })
    .input(RoleContract.changePermission)
    .output(RoleContract.entity);

  // The object the merge point in `procedure/index.ts` mounts. One place to add a
  // procedure to, rather than two.
  public static readonly all = {
    list: RoleProcedures.list,
    effective: RoleProcedures.effective,
    entitlement: RoleProcedures.entitlement,
    create: RoleProcedures.create,
    update: RoleProcedures.update,
    remove: RoleProcedures.remove,
    grant: RoleProcedures.grant,
    revoke: RoleProcedures.revoke,
  } as const;
}
