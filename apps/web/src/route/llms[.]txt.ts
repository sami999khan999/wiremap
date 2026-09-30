import { createFileRoute } from "@tanstack/react-router";
import type { DocNavNodeDto } from "~/import.js";
import { container } from "~/server/container.js";

// `/llms.txt`: every public page, one line each, linking its Markdown. The index an agent
// reads before it fetches anything — see https://llmstxt.org for the shape.
export const Route = createFileRoute("/llms.txt")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const origin = new URL(request.url).origin;
        const platform = await container.platform.organizationId();

        const body = await container.placedAt(
          platform,
          async () => {
            const { items } = await container.doc.listPlatformSpaces.execute(null);
            const lines = ["# Documentation", ""];
            for (const space of items) {
              const { space: view } = await container.doc.readPlatform.execute(null, {
                space: space.slug,
                path: "",
              });
              lines.push(`## ${space.title}`, "");
              if (space.description) lines.push(`> ${space.description}`, "");
              for (const page of flatten(view.nav)) {
                lines.push(`- [${page.title}](${origin}/api/doc/${space.slug}/${page.path})`);
              }
              lines.push("");
            }
            return lines.join("\n");
          },
          { replica: true },
        );

        return new Response(body, {
          headers: {
            "content-type": "text/plain; charset=utf-8",
            "cache-control": "public, max-age=300, s-maxage=300, stale-while-revalidate=86400",
          },
        });
      },
    },
  },
});

// The published pages in reading order. Sections and links carry no Markdown of their own.
const flatten = (nav: readonly DocNavNodeDto[]): { title: string; path: string }[] =>
  nav.flatMap((node) => [
    ...(node.kind === "page" && node.path ? [{ title: node.title, path: node.path }] : []),
    ...flatten(node.children),
  ]);
