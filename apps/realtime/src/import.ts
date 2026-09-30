// Everything this app takes from outside itself. `env.ts` is the one file that does not
// read from here, because it is parsed before anything else in the process exists.

// ── node ─────────────────────────────────────────────────────────────────────
export {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";

// ── @loadbearing/api-server ──────────────────────────────────────────────────
// The stream router, and nothing else from the procedure surface: this process serves
// `realtime.*` and every other path is the web app's.
export { RealtimeRouter } from "@loadbearing/api-server";

// ── @loadbearing/composition ─────────────────────────────────────────────────
export { Container } from "@loadbearing/composition";
// ── @orpc/server/node ────────────────────────────────────────────────────────
// The adapter, which is this app's own: `api-server` holds the router and never the HTTP.
export { RPCHandler } from "@orpc/server/node";
// ── @orpc/server ─────────────────────────────────────────────────────────────
export { CORSPlugin } from "@orpc/server/plugins";
