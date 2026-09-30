import { oc } from "../import.js";
import { Envelope } from "../primitive/index.js";
import { ApiKeyContract } from "./api-key.contract.js";

export class ApiKeyProcedures {
  private constructor() {}

  public static readonly list = oc
    .route({ method: "GET", path: "/api-keys" })
    .input(ApiKeyContract.listQuery)
    .output(Envelope.paginated(ApiKeyContract.entity));

  public static readonly create = oc
    .route({ method: "POST", path: "/api-keys" })
    .input(ApiKeyContract.create)
    .output(ApiKeyContract.created);

  // `POST` to a sub-path rather than `DELETE` on the key: revoking sets a timestamp and
  // the row stays, because a key that authenticated something is part of the audit trail.
  public static readonly revoke = oc
    .route({ method: "POST", path: "/api-keys/{apiKeyId}/revoke" })
    .input(ApiKeyContract.revoke)
    .output(ApiKeyContract.entity);

  // The object the merge point in `procedure/index.ts` mounts. One place to add a
  // procedure to, rather than two.
  public static readonly all = {
    list: ApiKeyProcedures.list,
    create: ApiKeyProcedures.create,
    revoke: ApiKeyProcedures.revoke,
  } as const;
}
