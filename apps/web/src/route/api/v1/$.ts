import { createFileRoute } from "@tanstack/react-router";
import { PublicApi } from "~/server/orpc/public-api.js";

// The public REST API and its OpenAPI document. A Start server route, like `/api/rpc`.
export const Route = createFileRoute("/api/v1/$")({
  server: { handlers: { ANY: ({ request }) => PublicApi.handle(request) } },
});
