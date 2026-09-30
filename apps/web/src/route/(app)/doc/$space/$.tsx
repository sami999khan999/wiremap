import { createFileRoute } from "@tanstack/react-router";
import {
  type ClientNamespace,
  DocNavTree,
  DocQueries,
  useApiClient,
  useAppQuery,
  useCapabilities,
  useMessages,
} from "~/import.js";
import { DocReaderRoute } from "~/route/-doc-reader.js";
import { RouteGuard } from "~/route/-guard.js";

const MESSAGES = ["doc"] as const satisfies readonly ClientNamespace[];

// One page of one space. The splat is the page's path under the space; an empty one is
// the space's first page, which is what `/doc/<space>/` lands on.
export const Route = createFileRoute("/(app)/doc/$space/$")({
  beforeLoad: RouteGuard.requirePermission("doc.page.read"),
  staticData: { messages: MESSAGES },
  loader: ({ context, params }) =>
    Promise.all([
      context.messages.ensure(MESSAGES),
      context.queryClient.ensureQueryData(
        DocQueries.reading(context.api, params.space, params._splat ?? ""),
      ),
      context.queryClient.ensureQueryData(DocQueries.spaces(context.api)),
    ]),
  component: DocPage,
});

function DocPage() {
  const { space, _splat } = Route.useParams();
  const { t } = useMessages("doc");
  const client = useApiClient();
  const capabilities = useCapabilities();
  const reading = useAppQuery(DocQueries.reading(client, space, _splat ?? ""));
  const spaces = useAppQuery(DocQueries.spaces(client));

  if (!reading.data) return null;
  const page = reading.data.page;

  return (
    <DocReaderRoute
      reading={reading.data}
      spaces={spaces.data?.items ?? []}
      root="/doc"
      back={{ href: "/dashboard", label: t("doc.back.app") }}
      // The organization's own docs are never fetchable from outside, so no raw link.
      editHref={
        page && capabilities.can("doc.page.write")
          ? `/doc/manage/${reading.data.space.id}/${page.id}`
          : null
      }
      search={(query) =>
        client.docPage
          .search({ query, limit: 10 })
          .then((result) => DocNavTree.hits(result.items, "/doc"))
      }
    />
  );
}
