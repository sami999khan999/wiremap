import { createFileRoute } from "@tanstack/react-router";
import { container } from "~/server/container.js";

// **Readiness, not liveness**: a 503 means "do not send me traffic yet". Unauthenticated,
// because an orchestrator has to reach it before any credential exists.
export const Route = createFileRoute("/api/health")({
  server: {
    handlers: {
      GET: async () => {
        const report = await container.health();

        return new Response(JSON.stringify(report), {
          status: report.healthy ? 200 : 503,
          headers: {
            "content-type": "application/json",
            // A cached readiness answer keeps reporting healthy for a TTL after the
            // thing it describes has stopped.
            "cache-control": "no-store",
          },
        });
      },
    },
  },
});
