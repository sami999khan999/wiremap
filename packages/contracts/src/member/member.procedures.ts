import { oc } from "../import.js";
import { Envelope } from "../primitive/index.js";
import { MemberContract } from "./member.contract.js";

export class MemberProcedures {
  private constructor() {}

  public static readonly list = oc
    .route({ method: "GET", path: "/members" })
    .input(MemberContract.listQuery)
    .output(Envelope.paginated(MemberContract.entity));

  public static readonly listInvitations = oc
    .route({ method: "GET", path: "/members/invitations" })
    .input(MemberContract.listQuery)
    .output(Envelope.paginated(MemberContract.invitation));

  public static readonly invite = oc
    .route({ method: "POST", path: "/members/invitations" })
    .input(MemberContract.invite)
    .output(MemberContract.invitation);

  public static readonly revokeInvitation = oc
    .route({ method: "DELETE", path: "/members/invitations/{invitationId}" })
    .input(MemberContract.revoke)
    .output(Envelope.acknowledged);

  // `POST` on a sub-resource, not `PUT` on the invitation: the row is not replaced by
  // the caller — a new token is issued, and only the server can know it.
  public static readonly resendInvitation = oc
    .route({ method: "POST", path: "/members/invitations/{invitationId}/resend" })
    .input(MemberContract.resend)
    .output(MemberContract.invitation);

  // `PATCH`, not `PUT`: the body carries the one field that changes, and the rest of
  // the membership is not the caller's to restate.
  public static readonly changeRole = oc
    .route({ method: "PATCH", path: "/members/{userId}/role" })
    .input(MemberContract.changeRole)
    .output(MemberContract.entity);

  // Two procedures rather than one taking a boolean: they carry different permissions
  // in every product that grows one, and a flag hides that in a request body.
  public static readonly deactivate = oc
    .route({ method: "POST", path: "/members/{userId}/deactivate" })
    .input(MemberContract.setActive)
    .output(MemberContract.entity);

  public static readonly reactivate = oc
    .route({ method: "POST", path: "/members/{userId}/reactivate" })
    .input(MemberContract.setActive)
    .output(MemberContract.entity);

  public static readonly remove = oc
    .route({ method: "DELETE", path: "/members/{userId}" })
    .input(MemberContract.remove)
    .output(Envelope.acknowledged);

  public static readonly listLinks = oc
    .route({ method: "GET", path: "/members/links" })
    .input(MemberContract.listQuery)
    .output(Envelope.paginated(MemberContract.invitationLink));

  public static readonly createLink = oc
    .route({ method: "POST", path: "/members/links" })
    .input(MemberContract.createLink)
    .output(MemberContract.createdInvitationLink);

  public static readonly revokeLink = oc
    .route({ method: "DELETE", path: "/members/links/{linkId}" })
    .input(MemberContract.revokeLink)
    .output(Envelope.acknowledged);

  public static readonly listDomains = oc
    .route({ method: "GET", path: "/members/domains" })
    .input(MemberContract.listQuery)
    .output(Envelope.paginated(MemberContract.domain));

  public static readonly addDomain = oc
    .route({ method: "POST", path: "/members/domains" })
    .input(MemberContract.addDomain)
    .output(MemberContract.domain);

  public static readonly removeDomain = oc
    .route({ method: "DELETE", path: "/members/domains/{domainId}" })
    .input(MemberContract.removeDomain)
    .output(Envelope.acknowledged);

  // The object the merge point in `procedure/index.ts` mounts. One place to add a
  // procedure to, rather than two.
  public static readonly all = {
    list: MemberProcedures.list,
    listInvitations: MemberProcedures.listInvitations,
    invite: MemberProcedures.invite,
    revokeInvitation: MemberProcedures.revokeInvitation,
    resendInvitation: MemberProcedures.resendInvitation,
    changeRole: MemberProcedures.changeRole,
    deactivate: MemberProcedures.deactivate,
    reactivate: MemberProcedures.reactivate,
    remove: MemberProcedures.remove,
    listLinks: MemberProcedures.listLinks,
    createLink: MemberProcedures.createLink,
    revokeLink: MemberProcedures.revokeLink,
    listDomains: MemberProcedures.listDomains,
    addDomain: MemberProcedures.addDomain,
    removeDomain: MemberProcedures.removeDomain,
  } as const;
}
