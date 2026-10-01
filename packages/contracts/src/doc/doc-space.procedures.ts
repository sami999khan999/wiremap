import { oc } from "../import.js";
import { Envelope } from "../primitive/index.js";
import { DocSpaceContract } from "./doc-space.contract.js";

export class DocSpaceProcedures {
  private constructor() {}

  public static readonly list = oc
    .route({ method: "GET", path: "/doc-spaces" })
    .output(DocSpaceContract.list);

  public static readonly get = oc
    .route({ method: "GET", path: "/doc-spaces/{spaceId}" })
    .input(DocSpaceContract.get)
    .output(DocSpaceContract.entity);

  public static readonly nav = oc
    .route({ method: "GET", path: "/doc-spaces/by-slug/{slug}/nav" })
    .input(DocSpaceContract.navQuery)
    .output(DocSpaceContract.nav);

  public static readonly create = oc
    .route({ method: "POST", path: "/doc-spaces" })
    .input(DocSpaceContract.create)
    .output(DocSpaceContract.entity);

  public static readonly update = oc
    .route({ method: "PUT", path: "/doc-spaces/{spaceId}" })
    .input(DocSpaceContract.update)
    .output(DocSpaceContract.entity);

  // Every page and revision in it goes too. There is no archive state: a space nobody
  // should read is `members` with nobody holding the key, not a second kind of deleted.
  public static readonly remove = oc
    .route({ method: "DELETE", path: "/doc-spaces/{spaceId}" })
    .input(DocSpaceContract.get)
    .output(Envelope.acknowledged);

  public static readonly all = {
    list: DocSpaceProcedures.list,
    get: DocSpaceProcedures.get,
    nav: DocSpaceProcedures.nav,
    create: DocSpaceProcedures.create,
    update: DocSpaceProcedures.update,
    remove: DocSpaceProcedures.remove,
  } as const;
}
