import { createFileRoute } from "@tanstack/react-router";
import { container } from "~/server/container.js";

// `/api/doc/<space>/<path>`: a public page's Markdown source, for "Open in …" and agents.
// Read as nobody, so a granted or members-only page is the same 404 as a missing one.
export const Route = createFileRoute("/api/doc/$")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        // No `.md`: a dev server answers any path with an extension as a static file.
        const [space, ...rest] = (params._splat ?? "").split("/");
        const path = rest.join("/") === "index" ? "" : rest.join("/");
        if (!space) return new Response("Not found", { status: 404 });

        const platform = await container.platform.organizationId();
        try {
          const { page } = await container.placedAt(
            platform,
            () => container.doc.readPlatform.execute(null, { space, path }),
            { replica: true },
          );
          if (!page) return new Response("Not found", { status: 404 });

          const heading = page.description
            ? `# ${page.title}\n\n> ${page.description}\n\n`
            : `# ${page.title}\n\n`;
          return new Response(`${heading}${page.markdown}\n`, {
            headers: {
              "content-type": "text/markdown; charset=utf-8",
              // Public by construction: only a public page reaches this line.
              "cache-control": "public, max-age=60, s-maxage=300, stale-while-revalidate=86400",
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
