import { oc } from "../import.js";
import { Envelope } from "../primitive/index.js";
import { OverrideContract } from "./override.contract.js";

// One person's exceptions to their role. Org scope only: goal-level rows are resolved but
// nothing writes them yet.
export class OverrideProcedures {
  private constructor() {}

  public static readonly list = oc
    .route({ method: "GET", path: "/overrides" })
    .input(OverrideContract.listQuery)
    .output(OverrideContract.list);

  public static readonly grant = oc
    .route({ method: "POST", path: "/overrides/grant" })
    .input(OverrideContract.grant)
    .output(OverrideContract.written);

  public static readonly deny = oc
    .route({ method: "POST", path: "/overrides/deny" })
    .input(OverrideContract.deny)
    .output(OverrideContract.written);

  public static readonly clear = oc
    .route({ method: "DELETE", path: "/overrides/{overrideId}" })
    .input(OverrideContract.clear)
    .output(Envelope.acknowledged);

  // The object the merge point in `procedure/index.ts` mounts. One place to add a
  // procedure to, rather than two.
  public static readonly all = {
    list: OverrideProcedures.list,
    grant: OverrideProcedures.grant,
    deny: OverrideProcedures.deny,
    clear: OverrideProcedures.clear,
  } as const;
}
