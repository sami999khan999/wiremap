import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import {
  type ClientNamespace,
  cn,
  DocEditorForm,
  type DocPageDraftDto,
  DocQueries,
  DocRevisionList,
  Identifiers,
  readerClassName,
  useApiClient,
  useAppQuery,
  useMessages,
  useState,
} from "~/import.js";
import { RouteGuard } from "~/route/-guard.js";

const MESSAGES = ["doc"] as const satisfies readonly ClientNamespace[];

// One page's editor beside its history. The draft is read fresh every time: two authors
// in one page is the case the version lock exists for.
export const Route = createFileRoute("/(app)/doc/manage/$spaceId/$pageId")({
  beforeLoad: RouteGuard.requirePermission("doc.page.write"),
  staticData: { messages: MESSAGES },
  params: {
    parse: ({ spaceId, pageId }) => {
      const space = Identifiers.docSpaceId.safeParse(spaceId);
      const page = Identifiers.docPageId.safeParse(pageId);
      if (!space.success || !page.success) throw notFound();
      return { spaceId: space.data, pageId: page.data };
    },
    stringify: ({ spaceId, pageId }) => ({ spaceId, pageId }),
  },
  loader: ({ context, params }) =>
    Promise.all([
      context.messages.ensure(MESSAGES),
      context.queryClient.ensureQueryData(DocQueries.page(context.api, params.pageId)),
    ]),
  component: DocEdit,
});

function DocEdit() {
  const { pageId } = Route.useParams();
  const { t } = useMessages("doc");
  const client = useApiClient();
  const draft = useAppQuery(DocQueries.page(client, pageId));
  // A restore replaces the draft underneath the form, so the form is remounted over it
  // rather than asked to reconcile its own unsaved state with the server's.
  const [generation, setGeneration] = useState(0);

  if (!draft.data) return null;
  const page: DocPageDraftDto = draft.data;

  return (
    <main id="main" className={cn(readerClassName.content, readerClassName.contentAside)}>
      <div className="ui-stack flex flex-col gap-3">
        <nav className={readerClassName.actions}>
          <Link to="/doc/manage/$spaceId" params={{ spaceId: page.spaceId }}>
            {t("doc.editor.back")}
          </Link>
        </nav>
        <header className={readerClassName.header}>
          <h1 className={readerClassName.title}>{t("doc.editor.title")}</h1>
        </header>
        <DocEditorForm key={`${page.id}:${generation}`} draft={page} />
      </div>
      <aside className={readerClassName.aside}>
        <DocRevisionList
          pageId={page.id}
          draftVersion={page.draftVersion}
          onRestored={() => setGeneration((value) => value + 1)}
        />
      </aside>
    </main>
  );
}
