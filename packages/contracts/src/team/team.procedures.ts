import { oc } from "../import.js";
import { Envelope } from "../primitive/index.js";
import { TeamContract } from "./team.contract.js";

export class TeamProcedures {
  private constructor() {}

  public static readonly list = oc
    .route({ method: "GET", path: "/teams" })
    .input(TeamContract.listQuery)
    .output(Envelope.paginated(TeamContract.entity));

  public static readonly members = oc
    .route({ method: "GET", path: "/teams/{teamId}/members" })
    .input(TeamContract.ref)
    .output(TeamContract.member.array().readonly());

  public static readonly create = oc
    .route({ method: "POST", path: "/teams" })
    .input(TeamContract.create)
    .output(TeamContract.entity);

  public static readonly update = oc
    .route({ method: "PATCH", path: "/teams/{teamId}" })
    .input(TeamContract.update)
    .output(TeamContract.entity);

  public static readonly remove = oc
    .route({ method: "DELETE", path: "/teams/{teamId}" })
    .input(TeamContract.ref)
    .output(Envelope.acknowledged);

  public static readonly addMember = oc
    .route({ method: "POST", path: "/teams/{teamId}/members" })
    .input(TeamContract.membership)
    .output(Envelope.acknowledged);

  public static readonly removeMember = oc
    .route({ method: "DELETE", path: "/teams/{teamId}/members/{userId}" })
    .input(TeamContract.membership)
    .output(Envelope.acknowledged);

  public static readonly all = {
    list: TeamProcedures.list,
    members: TeamProcedures.members,
    create: TeamProcedures.create,
    update: TeamProcedures.update,
    remove: TeamProcedures.remove,
    addMember: TeamProcedures.addMember,
    removeMember: TeamProcedures.removeMember,
  } as const;
}
