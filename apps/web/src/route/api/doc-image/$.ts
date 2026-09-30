import { createFileRoute } from "@tanstack/react-router";
import { Identifiers, z } from "~/import.js";
import { container } from "~/server/container.js";

const notFound = () => new Response("Not found", { status: 404 });

// `/api/doc-image/<organization>/<space>/<type>/<id>`: an image in a doc page, for whoever
// may read that page, as a redirect to a signed URL. The bucket itself is never public.
export const Route = createFileRoute("/api/doc-image/$")({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        const [organization, space, extension, id, ...extra] = (params._splat ?? "").split("/");
        const organizationId = Identifiers.organizationId.safeParse(organization);
        const spaceId = Identifiers.docSpaceId.safeParse(space);
        // An image id is a bare uuid: images are files in a space, not rows with a brand.
        const image = z.uuid().safeParse(id);
        if (
          !organizationId.success ||
          !spaceId.success ||
          !image.success ||
          !extension ||
          extra.length > 0
        ) {
          return notFound();
        }

        // Only the viewer's own organization or the platform's can answer, so nothing else
        // is placed: a guessed id would otherwise be a shard lookup and an error log each.
        const viewer = await container.principals.fromHeaders(request.headers);
        const platform = await container.platform.organizationId();
        if (organizationId.data !== platform && viewer?.organizationId !== organizationId.data) {
          return notFound();
        }
        try {
          const opened = await container.placedAt(
            organizationId.data,
            () =>
              container.doc.openImage.execute(viewer, {
                organizationId: organizationId.data,
                spaceId: spaceId.data,
                extension,
                id: image.data,
              }),
            { replica: true },
          );
          return new Response(null, {
            status: 302,
            headers: {
              location: opened.url,
              // Five minutes, well inside the signed URL's hour. Private unless the space
              // is public, so a shared cache never hands one reader's image to another.
              "cache-control": opened.public ? "public, max-age=300" : "private, max-age=300",
            },
          });
        } catch (error) {
          if (error instanceof Error && error.message === "NOT_FOUND") return notFound();
          throw error;
        }
      },
    },
  },
});
