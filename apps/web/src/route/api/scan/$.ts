import { createFileRoute } from "@tanstack/react-router";
import { ScanEndpoint } from "~/server/scan.server.js";

// The runner's four calls, `/api/scan/<organization>.<scan>/{checkout,upload,complete,fail}`.
export const Route = createFileRoute("/api/scan/$")({
  server: {
    handlers: {
      POST: ({ request, params }) => ScanEndpoint.handle(request, params._splat ?? ""),
    },
  },
});
