import { createFileRoute } from "@tanstack/react-router";
import { handleRpc } from "~/server/orpc/handler.js";

// A Start server route, not a Nitro one: only this survives a swap to the Cloudflare or
// Netlify plugin, which never scan Nitro's `serverDir` and drop `/api/*` silently.
export const Route = createFileRoute("/api/rpc/$")({
  server: { handlers: { ANY: ({ request }) => handleRpc(request) } },
});
