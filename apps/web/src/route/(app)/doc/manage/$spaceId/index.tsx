import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import {
  type ClientNamespace,
  DocPageTreeList,
  DocQueries,
  Identifiers,
  readerClassName,
  useApiClient,
  useAppQuery,
  useMessages,
} from "~/import.js";
import { DocLink } from "~/route/-doc-link.js";
import { RouteGuard } from "~/route/-guard.js";

const MESSAGES = ["doc"] as const satisfies readonly ClientNamespace[];

// One space's pages, drafts included, with the moves that arrange them.
export const Route = createFileRoute("/(app)/doc/manage/$spaceId/")({
  beforeLoad: RouteGuard.requirePermission("doc.page.write"),
  staticData: { messages: MESSAGES },
  // Parsed, not cast: an id typed into the address bar is input like any other.
  params: {
    parse: ({ spaceId }) => {
      const parsed = Identifiers.docSpaceId.safeParse(spaceId);
      if (!parsed.success) throw notFound();
      return { spaceId: parsed.data };
    },
    stringify: ({ spaceId }) => ({ spaceId }),
  },
  loader: ({ context, params }) =>
    Promise.all([
      context.messages.ensure(MESSAGES),
      context.queryClient.ensureQueryData(DocQueries.space(context.api, params.spaceId)),
      context.queryClient.ensureQueryData(DocQueries.tree(context.api, params.spaceId)),
    ]),
  component: DocSpacePages,
});

function DocSpacePages() {
  const { spaceId } = Route.useParams();
  const { t } = useMessages("doc");
  const client = useApiClient();
  const space = useAppQuery(DocQueries.space(client, spaceId));

  return (
    <main id="main" className={readerClassName.content}>
      <div className="ui-stack flex flex-col gap-3">
        <nav className={readerClassName.actions}>
          <Link to="/doc/manage">{t("doc.manage.title")}</Link>
          {space.data ? (
            <Link to="/doc/$space/$" params={{ space: space.data.slug, _splat: "" }}>
              {t("doc.space.open")}
            </Link>
          ) : null}
        </nav>
        <header className={readerClassName.header}>
          <h1 className={readerClassName.title}>{space.data?.title}</h1>
          <p className={readerClassName.description}>{t("doc.manage.pages")}</p>
        </header>
        <DocPageTreeList
          spaceId={spaceId}
          editHref={(pageId) => `/doc/manage/${spaceId}/${pageId}`}
          renderLink={DocLink.render}
        />
      </div>
    </main>
  );
}
