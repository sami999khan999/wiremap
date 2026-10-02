import { createFileRoute } from "@tanstack/react-router";
import { JobEndpoint } from "~/server/job.server.js";

// The dispatcher Worker's callback: one queue message per request, signed. A Start route
// and not a Nitro one, so it survives a hosting-adapter swap.
export const Route = createFileRoute("/api/internal/job")({
  server: {
    handlers: {
      POST: ({ request }) => JobEndpoint.handle(request),
    },
  },
});
