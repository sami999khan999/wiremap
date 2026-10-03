import { createFileRoute } from "@tanstack/react-router";
import { authMiddleware } from "../../auth";

export const Route = createFileRoute("/api/users")({
  server: {
    middleware: [authMiddleware],
    handlers: {
      GET: () => Response.json([]),
      POST: async ({ request }) => Response.json(await request.json()),
    },
  },
});
