import { createFileRoute, Link } from "@tanstack/react-router";
import {
  type ClientNamespace,
  DocQueries,
  DocSpaceList,
  readerClassName,
  useApiClient,
  useAppQuery,
  useCapabilities,
  useMessages,
} from "~/import.js";
import { DocLink } from "~/route/-doc-link.js";
import { RouteGuard } from "~/route/-guard.js";

const MESSAGES = ["doc"] as const satisfies readonly ClientNamespace[];

// Every space this organization has, as cards. The reader opens one; the space's own
// first page is where it lands.
export const Route = createFileRoute("/(app)/doc/")({
  beforeLoad: RouteGuard.requirePermission("doc.page.read"),
  staticData: { messages: MESSAGES },
  loader: ({ context }) =>
    Promise.all([
      context.messages.ensure(MESSAGES),
      context.queryClient.ensureQueryData(DocQueries.spaces(context.api)),
    ]),
  component: DocHome,
});

function DocHome() {
  const { t } = useMessages("doc");
  const client = useApiClient();
  const spaces = useAppQuery(DocQueries.spaces(client));
  const capabilities = useCapabilities();

  return (
    <main id="main" className={readerClassName.content}>
      <div className="ui-stack">
        <nav className={readerClassName.actions}>
          <Link to="/dashboard">{t("doc.back.app")}</Link>
          {capabilities.can("doc.page.write") ? (
            <Link to="/doc/manage">{t("doc.home.manage")}</Link>
          ) : null}
        </nav>
        <header className={readerClassName.header}>
          <h1 className={readerClassName.title}>{t("doc.home.title")}</h1>
          <p className={readerClassName.description}>{t("doc.home.description")}</p>
        </header>
        <DocSpaceList spaces={spaces.data?.items ?? []} root="/doc" renderLink={DocLink.render} />
      </div>
    </main>
  );
}
