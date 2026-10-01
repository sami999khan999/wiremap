import { createFileRoute } from "@tanstack/react-router";
import { container } from "~/server/container.js";

// `/api/doc-nav/<space>?v=<version>`: a platform space's whole tree, which a page read only
// carries trimmed. The version is in the URL, so the answer for it never changes.
export const Route = createFileRoute("/api/doc-nav/$")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const slug = params._splat ?? "";
        if (slug.length === 0 || slug.length > 60)
          return new Response("Not found", { status: 404 });

        const viewer = await container.principals.fromHeaders(request.headers);
        const platform = await container.platform.organizationId();
        try {
          const tree = await container.placedAt(
            platform,
            () => container.doc.readPlatformNav.execute(viewer, { slug }),
            { replica: true },
          );
          const asked = new URL(request.url).searchParams.get("v");
          // Immutable only for the version the reader named, and shared only when nobody is
          // signed in: a signed-in reader may see a granted space a stranger may not.
          const current = asked === String(tree.version);
          const shared = !request.headers.has("cookie") && !request.headers.has("authorization");
          return Response.json(tree, {
            headers: {
              "cache-control": !current
                ? "no-store"
                : shared
                  ? "public, max-age=31536000, immutable"
                  : "private, max-age=300",
              vary: "Cookie",
            },
          });
        } catch (error) {
          if (error instanceof Error && error.message === "NOT_FOUND") {
            return new Response("Not found", { status: 404 });
          }
          throw error;
        }
      },
    },
  },
});
