import { oc } from "../import.js";
import { Keyset } from "../primitive/index.js";
import { ActivityContract } from "./activity.contract.js";

export class ActivityProcedures {
  private constructor() {}

  public static readonly list = oc
    .route({ method: "GET", path: "/activity" })
    .input(ActivityContract.listQuery)
    .output(Keyset.page(ActivityContract.entity));

  public static readonly all = {
    list: ActivityProcedures.list,
  } as const;
}
