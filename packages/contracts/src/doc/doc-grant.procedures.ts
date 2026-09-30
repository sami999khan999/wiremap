import { oc } from "../import.js";
import { Envelope } from "../primitive/index.js";
import { DocGrantContract } from "./doc-grant.contract.js";

// The platform admin's side of a private space. All three are `platform.doc.grant`.
export class DocGrantProcedures {
  private constructor() {}

  public static readonly list = oc
    .route({ method: "GET", path: "/doc-grants" })
    .input(DocGrantContract.listQuery)
    .output(DocGrantContract.list);

  // One grant per space and grantee: saving the same one again replaces its reason and
  // expiry rather than failing.
  public static readonly save = oc
    .route({ method: "POST", path: "/doc-grants" })
    .input(DocGrantContract.save)
    .output(DocGrantContract.entity);

  public static readonly revoke = oc
    .route({ method: "DELETE", path: "/doc-grants/{grantId}" })
    .input(DocGrantContract.revoke)
    .output(Envelope.acknowledged);

  public static readonly all = {
    list: DocGrantProcedures.list,
    save: DocGrantProcedures.save,
    revoke: DocGrantProcedures.revoke,
  } as const;
}
