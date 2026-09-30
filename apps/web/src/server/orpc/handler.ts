import { container } from "../container.js";
import { Cors } from "../cors.js";
import { RPCHandler } from "../import.js";
import { appRouter } from "./app.router.js";

// One handler for the process, like the container: per request would rebuild the match
// table on every call. No context annotation, so the two cannot drift.
const handler = new RPCHandler(appRouter, {
  // Keep-alive is on by default at 5 s; 15 s is well inside every proxy idle timeout
  // worth worrying about and a third of the comment traffic.
  eventIteratorKeepAliveInterval: 15_000,
});

// Error shaping is **not** here: `errorMiddleware` does it inside the chain, where a
// `traceId` and a request-scoped logger exist.
export async function handleRpc(request: Request): Promise<Response> {
  const preflight = Cors.preflight(request);
  if (preflight) return preflight;

  const { matched, response } = await handler.handle(request, {
    prefix: "/api/rpc",
    context: { container, headers: request.headers },
  });

  return Cors.apply(request, matched ? response : new Response(null, { status: 404 }));
}
