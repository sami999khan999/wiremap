import { eventIterator, oc } from "../import.js";
import { RealtimeContract } from "./realtime.contract.js";

export class RealtimeProcedures {
  private constructor() {}

  // The `route` is OpenAPI metadata, like every sibling's. `RPCHandler` — the only
  // handler this repo mounts — dispatches on the procedure path and never reads it.
  public static readonly stream = oc
    .route({ method: "GET", path: "/realtime/stream" })
    .output(eventIterator(RealtimeContract.message));

  public static readonly all = {
    stream: RealtimeProcedures.stream,
  } as const;
}
