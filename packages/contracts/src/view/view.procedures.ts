import { oc } from "../import.js";
import { Envelope } from "../primitive/index.js";
import { ViewContract } from "./view.contract.js";

export class ViewProcedures {
  private constructor() {}

  public static readonly list = oc
    .route({ method: "GET", path: "/projects/{projectId}/views" })
    .input(ViewContract.list)
    .output(ViewContract.entity.array().readonly());

  public static readonly save = oc
    .route({ method: "POST", path: "/projects/{projectId}/views" })
    .input(ViewContract.save)
    .output(ViewContract.entity);

  public static readonly remove = oc
    .route({ method: "DELETE", path: "/projects/{projectId}/views/{viewId}" })
    .input(ViewContract.remove)
    .output(Envelope.acknowledged);

  public static readonly all = {
    list: ViewProcedures.list,
    save: ViewProcedures.save,
    remove: ViewProcedures.remove,
  } as const;
}
