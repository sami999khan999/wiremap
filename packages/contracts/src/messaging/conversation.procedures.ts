import { oc } from "../import.js";
import { Envelope, Keyset } from "../primitive/index.js";
import { ConversationContract } from "./conversation.contract.js";

export class ConversationProcedures {
  private constructor() {}

  public static readonly list = oc
    .route({ method: "GET", path: "/conversations" })
    .input(ConversationContract.listQuery)
    .output(Keyset.page(ConversationContract.entity));

  // Returns the existing conversation for a direct pair rather than a conflict: opening
  // a DM twice is the same intent both times.
  public static readonly create = oc
    .route({ method: "POST", path: "/conversations" })
    .input(ConversationContract.create)
    .output(ConversationContract.entity);

  public static readonly get = oc
    .route({ method: "GET", path: "/conversations/{conversationId}" })
    .input(ConversationContract.get)
    .output(ConversationContract.entity);

  public static readonly addMember = oc
    .route({ method: "POST", path: "/conversations/{conversationId}/members" })
    .input(ConversationContract.memberRef)
    .output(Envelope.acknowledged);

  public static readonly removeMember = oc
    .route({ method: "DELETE", path: "/conversations/{conversationId}/members/{userId}" })
    .input(ConversationContract.memberRef)
    .output(Envelope.acknowledged);

  // Separate from `removeMember` with your own id: leaving is a thing you may always do
  // and removing is a thing an owner does, and one endpoint would gate them together.
  public static readonly leave = oc
    .route({ method: "POST", path: "/conversations/{conversationId}/leave" })
    .input(ConversationContract.leave)
    .output(Envelope.acknowledged);

  public static readonly rename = oc
    .route({ method: "PUT", path: "/conversations/{conversationId}" })
    .input(ConversationContract.rename)
    .output(Envelope.acknowledged);

  public static readonly markRead = oc
    .route({ method: "POST", path: "/conversations/{conversationId}/read" })
    .input(ConversationContract.markRead)
    .output(Envelope.acknowledged);

  public static readonly all = {
    list: ConversationProcedures.list,
    create: ConversationProcedures.create,
    get: ConversationProcedures.get,
    addMember: ConversationProcedures.addMember,
    removeMember: ConversationProcedures.removeMember,
    leave: ConversationProcedures.leave,
    rename: ConversationProcedures.rename,
    markRead: ConversationProcedures.markRead,
  } as const;
}
