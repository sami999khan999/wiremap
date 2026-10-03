import { createFileRoute } from "@tanstack/react-router";
import { StorageEndpoint } from "~/server/storage.server.js";

// Signed storage links when the bucket is not published (`S3_ACCESS=proxied`).
export const Route = createFileRoute("/api/storage/$")({
  server: {
    handlers: {
      GET: ({ request }) => StorageEndpoint.handle(request),
      PUT: ({ request }) => StorageEndpoint.handle(request),
    },
  },
});
