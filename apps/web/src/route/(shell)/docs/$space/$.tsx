import { createFileRoute, notFound } from "@tanstack/react-router";
import {
  type ClientNamespace,
  type DocNavNodeDto,
  DocNavTree,
  useAppQuery,
  useCapabilities,
  useIsPlatformOrganization,
  useMessages,
} from "~/import.js";
import { DocReaderRoute } from "~/route/-doc-reader.js";
import {
  fetchPlatformDocReading,
  fetchPlatformDocSpaces,
  type PlatformDocReading,
  searchPlatformDocs,
} from "~/server/doc.fn.js";
import { DocCacheHeaders } from "../-cache.js";

const MESSAGES = ["doc"] as const satisfies readonly ClientNamespace[];

// The `["docs", "read", …]` shape `ArticleHtmlStore` strips, beside `/doc`'s `["doc", …]`.
const reading = (space: string, path: string) => ({
  queryKey: ["docs", "read", space, path] as const,
  queryFn: (): Promise<PlatformDocReading> => fetchPlatformDocReading({ data: { space, path } }),
  staleTime: 30_000,
});

// One page of a platform space. The server function decides whether this reader may see
// it; a space they may not is the same 404 as one that does not exist.
export const Route = createFileRoute("/(shell)/docs/$space/$")({
  staticData: { messages: MESSAGES },
  // The reading goes through the query cache, not the loader's return: loader data is
  // always serialised whole, and the cache's copy can leave the page HTML out.
  loader: async ({ context, params }) => {
    const [, read, listed] = await Promise.all([
      context.messages.ensure(MESSAGES),
      context.queryClient.ensureQueryData(reading(params.space, params._splat ?? "")),
      fetchPlatformDocSpaces(),
    ]);
    if (!read.reading) throw notFound();
    return { spaces: listed.spaces, cacheable: read.cacheable && listed.cacheable };
  },
  headers: ({ loaderData }) => DocCacheHeaders.of(loaderData?.cacheable),
  component: PublicDocPage,
});

function PublicDocPage() {
  const { t } = useMessages("doc");
  const { spaces } = Route.useLoaderData();
  const params = Route.useParams();
  const read = useAppQuery<PlatformDocReading, Error, PlatformDocReading, readonly unknown[]>(
    reading(params.space, params._splat ?? ""),
  );
  const capabilities = useCapabilities();
  const platform = useIsPlatformOrganization();
  const path = params._splat ?? "";
  if (!read.data?.reading) return null;
  const current = read.data.reading;
  const page = current.page;

  // Staff of the platform may jump to the editor; nobody else is shown the way in.
  const editHref =
    page && platform && capabilities.can("doc.page.write")
      ? `/doc/manage/${current.space.id}/${page.id}`
      : null;
  // Only a public, unlinked page can be fetched by an outside tool, so only it offers raw
  // Markdown: the source route reads as nobody, and nobody fails every access link.
  const markdownHref =
    page &&
    current.space.audience === "public" &&
    !DocNavTree.isLinked(current.space.access, current.space.nav, page.id)
      ? `/api/doc/${current.space.slug}/${path.length > 0 ? path : "index"}`
      : null;

  return (
    <DocReaderRoute
      reading={current}
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
        fetch(`/api/doc-nav/${current.space.slug}?v=${current.space.version}`)
          .then((response) =>
            response.ok ? response.json() : Promise.reject(new Error(String(response.status))),
          )
          .then((tree: { nav: readonly DocNavNodeDto[] }) => tree.nav)
      }
    />
  );
}
