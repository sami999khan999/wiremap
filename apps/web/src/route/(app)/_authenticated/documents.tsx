import { createFileRoute } from "@tanstack/react-router";
import {
  Can,
  type ClientNamespace,
  DocumentSearch,
  IndexDocumentForm,
  Page,
  useCapabilities,
  useMessages,
} from "~/import.js";
import { RouteGuard } from "~/route/-guard.js";

const MESSAGES = ["document"] as const satisfies readonly ClientNamespace[];

// Behind `ai.embedding.read` — the same key `document.search` is gated on. Indexing is
// a separate key, so the form below is gated separately rather than by this guard.
export const Route = createFileRoute("/(app)/_authenticated/documents")({
  beforeLoad: RouteGuard.requirePermission("ai.embedding.read"),
  staticData: { messages: MESSAGES },
  // No `ensureQueryData`: both halves of this page are mutations, so there is nothing
  // to prefetch — a search has to be asked for.
  loader: ({ context }) => context.messages.ensure(MESSAGES),
  component: Documents,
});

function Documents() {
  const { t } = useMessages("document");
  const capabilities = useCapabilities();

  return (
    <Page>
      <h1>{t("document.title")}</h1>
      <p>{t("document.subtitle")}</p>
      <Can permission="ai.embedding.write" capabilities={capabilities}>
        <IndexDocumentForm />
      </Can>
      <DocumentSearch />
    </Page>
  );
}
