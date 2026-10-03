// **The second of this app's two outside surfaces**, and the only place under
// `apps/web/src` allowed to name the server graph. See docs/reference/import-surfaces.md.

// ── @loadbearing/api-server ──────────────────────────────────────────────────
// The router half of the transport: every procedure builds on `authed`, and the stream
// router is mounted here for one release while `apps/realtime` takes the streams over.
export { authed, RealtimeRouter } from "@loadbearing/api-server";

// ── @loadbearing/composition ─────────────────────────────────────────────────
export {
  ConsumerRegistry,
  Container,
  JobSignatureHasher,
  type QueueJob,
} from "@loadbearing/composition";

// ── @loadbearing/errors ──────────────────────────────────────────────────────
export { NotFoundError } from "@loadbearing/errors";

// ── @orpc/server ─────────────────────────────────────────────────────────────
// Never `EventPublisher` from here. It is oRPC's own in-process fan-out, and reaching
// for it would put a second, replica-local realtime path beside the Redis one.
export { createRouterClient } from "@orpc/server";

// ── @orpc/server/fetch ───────────────────────────────────────────────────────
export { RPCHandler } from "@orpc/server/fetch";
