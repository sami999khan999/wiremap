import { oc, z } from "../import.js";
import { GithubContract } from "./github.contract.js";

export class GithubProcedures {
  private constructor() {}

  public static readonly status = oc
    .route({ method: "GET", path: "/github/status" })
    .input(z.object({}))
    .output(GithubContract.status);

  public static readonly all = {
    status: GithubProcedures.status,
  } as const;
}
