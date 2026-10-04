import { createFileRoute } from "@tanstack/react-router";
import { GithubEndpoint } from "~/server/github.server.js";

// The App manifest's `redirect_url`: GitHub sends the platform admin here once it has
// created the App, with the code its keys are exchanged for.
export const Route = createFileRoute("/api/github/manifest")({
  server: {
    handlers: {
      GET: ({ request }) => GithubEndpoint.manifest(request),
    },
  },
});
