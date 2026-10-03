import { createFileRoute } from "@tanstack/react-router";
import { GithubEndpoint } from "~/server/github.server.js";

// The App's webhook URL. The raw body is read once, verified, then parsed.
export const Route = createFileRoute("/api/github/webhook")({
  server: {
    handlers: {
      POST: ({ request }) => GithubEndpoint.webhook(request),
    },
  },
});
