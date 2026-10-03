import { oc } from "../import.js";
import { Envelope } from "../primitive/index.js";
import { WebhookContract } from "./webhook.contract.js";

export class WebhookProcedures {
  private constructor() {}

  public static readonly list = oc
    .route({ method: "GET", path: "/webhooks" })
    .output(WebhookContract.entity.array().readonly());

  public static readonly create = oc
    .route({ method: "POST", path: "/webhooks" })
    .input(WebhookContract.create)
    .output(WebhookContract.created);

  public static readonly update = oc
    .route({ method: "PATCH", path: "/webhooks/{webhookId}" })
    .input(WebhookContract.update)
    .output(WebhookContract.entity);

  public static readonly remove = oc
    .route({ method: "DELETE", path: "/webhooks/{webhookId}" })
    .input(WebhookContract.ref)
    .output(Envelope.acknowledged);

  public static readonly test = oc
    .route({ method: "POST", path: "/webhooks/{webhookId}/test" })
    .input(WebhookContract.ref)
    .output(WebhookContract.tested);

  public static readonly all = {
    list: WebhookProcedures.list,
    create: WebhookProcedures.create,
    update: WebhookProcedures.update,
    remove: WebhookProcedures.remove,
    test: WebhookProcedures.test,
  } as const;
}
