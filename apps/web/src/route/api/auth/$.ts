import { createFileRoute } from "@tanstack/react-router";
import { container } from "~/server/container.js";
import { Cors } from "~/server/cors.js";

// Better Auth speaks the Fetch API, so these four lines are the whole binding. CORS is
// not optional: a second shell is cross-origin against both entrypoints.
export const Route = createFileRoute("/api/auth/$")({
  server: {
    handlers: {
      ANY: async ({ request }) => {
        const preflight = Cors.preflight(request);
        if (preflight) return preflight;

        return Cors.apply(request, await container.auth.handler(request));
      },
    },
  },
});
