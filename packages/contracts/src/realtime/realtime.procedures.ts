import { eventIterator, oc } from "../import.js";
import { ConversationContract } from "../messaging/index.js";
import { RealtimeContract } from "./realtime.contract.js";

export class RealtimeProcedures {
  private constructor() {}

  // The `route` is OpenAPI metadata, like every sibling's. `RPCHandler` — the only
  // handler this repo mounts — dispatches on the procedure path and never reads it.
  public static readonly stream = oc
    .route({ method: "GET", path: "/realtime/stream" })
    .output(eventIterator(RealtimeContract.message));

  // The second stream. Opened only while a conversation is on screen, which is what
  // keeps a tab to two connections rather than one per conversation it has ever seen.
  public static readonly conversation = oc
    .route({ method: "GET", path: "/realtime/conversation" })
    .input(ConversationContract.get)
    .output(eventIterator(RealtimeContract.message));

  public static readonly all = {
    stream: RealtimeProcedures.stream,
    conversation: RealtimeProcedures.conversation,
  } as const;
}
