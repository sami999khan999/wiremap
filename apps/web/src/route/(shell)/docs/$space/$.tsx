import { createFileRoute, notFound } from "@tanstack/react-router";
import {
  type ClientNamespace,
  type DocNavNodeDto,
  DocNavTree,
  useCapabilities,
  useIsPlatformOrganization,
  useMessages,
} from "~/import.js";
import { DocReaderRoute } from "~/route/-doc-reader.js";
import {
  fetchPlatformDocReading,
  fetchPlatformDocSpaces,
  searchPlatformDocs,
} from "~/server/doc.fn.js";
import { DocCacheHeaders } from "../-cache.js";

const MESSAGES = ["doc"] as const satisfies readonly ClientNamespace[];

// One page of a platform space. The server function decides whether this reader may see
// it; a space they may not is the same 404 as one that does not exist.
export const Route = createFileRoute("/(shell)/docs/$space/$")({
  staticData: { messages: MESSAGES },
  loader: async ({ context, params }) => {
    const [, read, listed] = await Promise.all([
      context.messages.ensure(MESSAGES),
      fetchPlatformDocReading({ data: { space: params.space, path: params._splat ?? "" } }),
      fetchPlatformDocSpaces(),
    ]);
    if (!read.reading) throw notFound();
    return {
      reading: read.reading,
      spaces: listed.spaces,
      cacheable: read.cacheable && listed.cacheable,
    };
  },
  headers: ({ loaderData }) => DocCacheHeaders.of(loaderData?.cacheable),
  component: PublicDocPage,
});

function PublicDocPage() {
  const { t } = useMessages("doc");
  const { reading, spaces } = Route.useLoaderData();
  const capabilities = useCapabilities();
  const platform = useIsPlatformOrganization();
  const page = reading.page;
  const path = Route.useParams()._splat ?? "";

  // Staff of the platform may jump to the editor; nobody else is shown the way in.
  const editHref =
    page && platform && capabilities.can("doc.page.write")
      ? `/doc/manage/${reading.space.id}/${page.id}`
      : null;
  // Only a public page can be fetched by an outside tool, so only it offers raw Markdown.
  const markdownHref =
    page && reading.space.audience === "public"
      ? `/api/doc/${reading.space.slug}/${path.length > 0 ? path : "index"}`
      : null;

  return (
    <DocReaderRoute
      reading={reading}
      spaces={spaces}
      root="/docs"
      back={{ href: "/", label: t("doc.back.home") }}
      editHref={editHref}
      markdownHref={markdownHref}
      search={(query) =>
        searchPlatformDocs({ data: { query, limit: 10 } }).then((items) =>
          DocNavTree.hits(items, "/docs"),
        )
      }
      // A plain GET with the version in the URL, so a browser and a CDN keep it for good.
      loadNav={() =>
        fetch(`/api/doc-nav/${reading.space.slug}?v=${reading.space.version}`)
          .then((response) =>
            response.ok ? response.json() : Promise.reject(new Error(String(response.status))),
          )
          .then((tree: { nav: readonly DocNavNodeDto[] }) => tree.nav)
      }
    />
  );
}
