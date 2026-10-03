import { createFileRoute } from "@tanstack/react-router";
import { GithubEndpoint } from "~/server/github.server.js";

// The App's "Setup URL": GitHub sends the installer here after they choose repositories.
export const Route = createFileRoute("/api/github/setup")({
  server: {
    handlers: {
      GET: ({ request }) => GithubEndpoint.setup(request),
    },
  },
});
