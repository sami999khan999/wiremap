import { oc } from "../import.js";
import { Envelope } from "../primitive/index.js";
import { CommentContract } from "./comment.contract.js";

export class CommentProcedures {
  private constructor() {}

  public static readonly list = oc
    .route({ method: "GET", path: "/projects/{projectId}/comments" })
    .input(CommentContract.list)
    .output(CommentContract.entity.array().readonly());

  public static readonly create = oc
    .route({ method: "POST", path: "/projects/{projectId}/comments" })
    .input(CommentContract.create)
    .output(CommentContract.entity);

  public static readonly update = oc
    .route({ method: "PATCH", path: "/projects/{projectId}/comments/{commentId}" })
    .input(CommentContract.update)
    .output(CommentContract.entity);

  public static readonly remove = oc
    .route({ method: "DELETE", path: "/projects/{projectId}/comments/{commentId}" })
    .input(CommentContract.ref)
    .output(Envelope.acknowledged);

  public static readonly resolve = oc
    .route({ method: "PUT", path: "/projects/{projectId}/comments/{commentId}/resolved" })
    .input(CommentContract.toggle)
    .output(CommentContract.entity);

  public static readonly pin = oc
    .route({ method: "PUT", path: "/projects/{projectId}/comments/{commentId}/pinned" })
    .input(CommentContract.toggle)
    .output(CommentContract.entity);

  public static readonly all = {
    list: CommentProcedures.list,
    create: CommentProcedures.create,
    update: CommentProcedures.update,
    remove: CommentProcedures.remove,
    resolve: CommentProcedures.resolve,
    pin: CommentProcedures.pin,
  } as const;
}
